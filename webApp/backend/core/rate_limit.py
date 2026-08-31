from slowapi import Limiter
from slowapi.util import get_remote_address

# Limiter compartido por toda la app. Usa la IP del cliente como clave, lo
# que asume un único proxy de confianza por delante; con varios proxies
# habría que leer la cabecera X-Forwarded-For.
limiter = Limiter(key_func=get_remote_address)
