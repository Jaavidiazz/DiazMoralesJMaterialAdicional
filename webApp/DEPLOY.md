# Despliegue de breastia.es en un VPS (Docker Compose + Caddy)

Pasos para desplegar `webApp/` (backend FastAPI + Detectron2 y frontend
Next.js) en un VPS sin GPU, con TLS automático mediante Caddy y Let's Encrypt.

## 0. Qué se despliega

- `backend`: FastAPI, Torch CPU y Detectron2 (compilado desde fuente durante
  el build). Usa Supabase (servicio externo ya alojado) y la API de Gemini.
- `frontend`: Next.js 16 en modo standalone. Habla con Supabase desde el
  navegador y con `backend` a través de `NEXT_PUBLIC_API_URL`.
- `caddy`: reverse proxy y TLS automático para `breastia.es`,
  `www.breastia.es` y `api.breastia.es`.

Los pesos del modelo (`backend/model/*.pth`, unos 315 MB) no están en git y
hay que copiarlos al VPS aparte (paso 5).

## 1. Contratar el VPS

Al no haber GPU y existir un paso de compilación de Detectron2 que consume
RAM y tarda, conviene un mínimo de **4 vCPU / 8 GB RAM / 80 GB de disco**.
Con 2-4 GB de RAM la compilación puede agotar la memoria o tardar bastante
más; en ese caso hay que añadir swap antes del build (paso 6).

Opciones con buena relación precio/rendimiento: Hetzner CPX31, DigitalOcean
Premium AMD 4 vCPU/8 GB, OVH o Contabo. Sistema operativo: Ubuntu 22.04 o
24.04 LTS.

## 2. Comprar el dominio breastia.es

Los dominios `.es` los gestiona Red.es y requieren un registrador autorizado
(Namecheap, OVH, Dinahosting, Acens, entre otros).

## 3. DNS

En el panel del registrador o del gestor de DNS, crear 3 registros `A`
apuntando todos a la IP pública del VPS:

```
breastia.es       A   <IP_DEL_VPS>
www.breastia.es   A   <IP_DEL_VPS>
api.breastia.es   A   <IP_DEL_VPS>
```

La propagación puede tardar de minutos a un par de horas. Conviene verificar
con `dig breastia.es +short` antes de seguir: Caddy necesita que el DNS
resuelva para pedir el certificado por HTTP-01.

## 4. Preparar el VPS

```bash
# como root, crear usuario sin privilegios y desactivar login de root/password
adduser deploy
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy

# en /etc/ssh/sshd_config: PasswordAuthentication no, PermitRootLogin no
systemctl restart sshd

# firewall: solo SSH, HTTP, HTTPS
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable

# Docker
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
```

A partir de aquí se trabaja como usuario `deploy`.

## 5. Subir el código y los pesos del modelo

Desde la máquina local (este repo):

```bash
# código (también se puede usar git clone en el VPS si el repo está alojado)
rsync -avz --exclude node_modules --exclude .next --exclude __pycache__ \
  webApp/ deploy@<IP_DEL_VPS>:~/breastia/webApp/

# pesos del modelo (no están en git, unos 315 MB)
scp -r webApp/backend/model deploy@<IP_DEL_VPS>:~/breastia/webApp/backend/model
```

## 6. Variables de entorno

En el VPS, dentro de `~/breastia/webApp/`:

```bash
cp .env.example .env
cp backend/.env.example backend/.env
```

Rellenar `backend/.env` con los valores reales de `SUPABASE_URL`,
`SUPABASE_SERVICE_KEY` y `GEMINI_API_KEY`. Para producción es recomendable
rotar la service key de Supabase y las claves de API.

Rellenar `.env` (raíz de `webApp/`) con `DOMAIN=breastia.es`, el email para
Let's Encrypt y las variables `NEXT_PUBLIC_*` (URL y anon key de Supabase; la
anon key es pública y no necesita rotación).

Si el VPS tiene menos de 8 GB de RAM, añadir swap antes de compilar:

```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
```

## 7. Build y arranque

```bash
cd ~/breastia/webApp
docker compose build   # compila Detectron2 desde fuente, entre 15 y 30 min
docker compose up -d
```

Verificación:

```bash
docker compose ps
docker compose logs -f backend    # uvicorn arrancado y predictor cargado
curl -s https://api.breastia.es/health
```

`/health` (definido en `backend/routers/system.py`) debe devolver
`"detectron_loaded": true`. El frontend está en `https://breastia.es`. Caddy
emite el certificado TLS en el primer arranque, por lo que la primera carga
puede tardar unos segundos más.

## 8. Actualizar tras cambios

```bash
git pull   # o repetir el rsync del paso 5
docker compose build
docker compose up -d
```

## 9. Notas

- Los uploads de casos (`backend/uploads/`) persisten en el volumen Docker
  `backend_uploads`: no se pierden con `docker compose up -d`, sí con
  `docker compose down -v`.
- Supabase (base de datos y auth) está fuera del VPS y no se respalda aquí.
- El CORS del backend está limitado a `CORS_ORIGINS` en `backend/.env`; si
  cambia el dominio hay que actualizarlo ahí.
- La rotación de logs está configurada en `docker-compose.yml` (máximo
  10 MB por 3 archivos y servicio).
