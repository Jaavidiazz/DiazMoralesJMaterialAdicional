import os

from dotenv import load_dotenv
from supabase import create_client, Client as SupabaseClient
from google import genai

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    raise RuntimeError("Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY en .env")

if not GEMINI_API_KEY:
    raise RuntimeError("Falta GEMINI_API_KEY en .env")

supabase: SupabaseClient = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

genai_client = genai.Client(api_key=GEMINI_API_KEY)

GEMINI_PRIMARY_MODEL = "gemini-2.5-flash"
GEMINI_FALLBACK_MODEL = "gemini-flash-latest"

_default_origins = "http://localhost:3000,http://127.0.0.1:3000"
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", _default_origins).split(",") if o.strip()]

UPLOAD_DIR = "uploads"
MODEL_DIR = "model"
TMP_DIR = "tmp"

CFG_PATH = os.path.join(MODEL_DIR, "detectron.cfg.yaml")
BEST_WEIGHTS_PATH = os.path.join(MODEL_DIR, "best_model.pth")
FINAL_WEIGHTS_PATH = os.path.join(MODEL_DIR, "model_final.pth")
WEIGHTS_PATH = BEST_WEIGHTS_PATH if os.path.exists(BEST_WEIGHTS_PATH) else FINAL_WEIGHTS_PATH

DATASET_BUCKET = "mamografias"
DATASET_PREFIX = "dataset"

# Límite de tamaño para imágenes subidas en /cases/ (evita DoS con archivos gigantes)
MAX_UPLOAD_SIZE_BYTES = 15 * 1024 * 1024  # 15 MB
ALLOWED_IMAGE_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}

# Límite de tamaño para pesos/cfg del modelo en /admin/model/upload
MAX_MODEL_WEIGHTS_SIZE_BYTES = 500 * 1024 * 1024  # 500 MB
MAX_MODEL_CFG_SIZE_BYTES = 2 * 1024 * 1024  # 2 MB

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(TMP_DIR, exist_ok=True)
