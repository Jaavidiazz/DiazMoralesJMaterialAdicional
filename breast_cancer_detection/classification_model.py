import argparse
import base64
import json
import random
from pathlib import Path
import numpy as np
import matplotlib.pyplot as plt
import pytorch_lightning as pl
import torch
import torch.nn as nn
import torch.optim as optim
from torchcam.methods import GradCAM
from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image, ImageDraw
from pytorch_lightning.callbacks import EarlyStopping, ModelCheckpoint
from torch.utils.data import DataLoader, Dataset
from torchcam.utils import overlay_mask
from torchvision import transforms
from torchvision.models import resnet18, ResNet18_Weights
from torchvision.transforms.functional import to_pil_image
from waitress import serve
from cloudpickle import pickle
import os

# --- Detectron2 / OpenCV ---
import cv2
from detectron2.engine import DefaultPredictor

API_PORT = 33519
num_classes = 2
device = 'cuda' if torch.cuda.is_available() else 'cpu'
SEED = 42
random.seed(SEED)
np.random.seed(SEED)
torch.manual_seed(SEED)
pl.seed_everything(SEED, workers=True)

script_dir = os.path.dirname(os.path.realpath(__file__))
save_dir_default = os.path.join(script_dir, "classification_output")
torch.set_float32_matmul_precision('medium')

# ====== RUTAS DETECTRON2 (AJUSTA ESTO) ======
# Este NO es el dataset.yaml. Es el YAML de configuración del modelo de Detectron.
DETECTRON_CFG_PATH = os.path.join(script_dir, "detectron.cfg.pkl")  # <-- pon aquí tu yaml de modelo
DETECTRON_WEIGHTS_PATH = os.path.join(script_dir, "output", "model_final.pth")  # <-- tu .pth de Detectron
_detectron_predictor = None
# ============================================

default_transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])


class JSONImageDataset(Dataset):
    def __init__(self, json_path, img_dir, transform=default_transform):
        self.img_dir = Path(img_dir)
        with open(json_path, 'r') as f:
            self.data = json.load(f)
        self.transform = transform

    def __len__(self):
        return len(self.data)

    def __getitem__(self, idx):
        img_path = self.img_dir / self.data[idx]['file_name']
        label = self.data[idx]['class_id']
        image = Image.open(img_path).convert('RGB')
        if self.transform:
            image = self.transform(image)
        return image, label


class ImageClassifier(pl.LightningModule):
    def __init__(self, num_classes=num_classes):
        super().__init__()
        # Usar la API nueva de weights para evitar warnings
        self.model = resnet18(weights=ResNet18_Weights.DEFAULT)
        self.model.fc = nn.Linear(self.model.fc.in_features, num_classes)
        self.criterion = nn.CrossEntropyLoss()

        self.save_hyperparameters(ignore=['model', 'criterion'])

    def forward(self, x):
        return self.model(x)

    def training_step(self, batch, batch_idx):
        x, y = batch
        y_hat = self(x)
        loss = self.criterion(y_hat, y)
        self.log('train_loss', loss)
        return loss

    def configure_optimizers(self):
        return optim.Adam(self.parameters(), lr=0.001)


def evaluate_model(model, dataloader):
    model.eval()
    correct = 0
    total = 0
    model.to(device)
    with torch.no_grad():
        for images, labels in dataloader:
            images = images.to(device)
            labels = labels.to(device)
            outputs = model(images)
            _, predicted = torch.max(outputs, 1)
            total += labels.size(0)
            correct += (predicted == labels).sum().item()
    accuracy = correct / total
    print(f"Evaluation Accuracy: {accuracy:.2f}")


def get_detectron_predictor():
    """Inicializa (o devuelve) el predictor de Detectron2 usando detectron.cfg.pkl."""
    global _detectron_predictor
    if _detectron_predictor is not None:
        return _detectron_predictor

    print(f"[Detectron] Cargando cfg desde: {DETECTRON_CFG_PATH}")
    print(f"[Detectron] Cargando pesos desde: {DETECTRON_WEIGHTS_PATH}")

    if not os.path.exists(DETECTRON_CFG_PATH):
        raise FileNotFoundError(f"No se encuentra {DETECTRON_CFG_PATH}")
    if not os.path.exists(DETECTRON_WEIGHTS_PATH):
        raise FileNotFoundError(f"No se encuentra {DETECTRON_WEIGHTS_PATH}")

    # Cargar cfg desde el pickle que guardaste al entrenar
    with open(DETECTRON_CFG_PATH, "rb") as f:
        cfg = pickle.load(f)

    # 🔓 Descongelar, modificar, y volver a congelar
    if cfg.is_frozen():
        cfg.defrost()
    cfg.MODEL.WEIGHTS = DETECTRON_WEIGHTS_PATH
    cfg.MODEL.ROI_HEADS.SCORE_THRESH_TEST = 0.5
    cfg.MODEL.DEVICE = "cpu"
    cfg.freeze()

    _detectron_predictor = DefaultPredictor(cfg)
    return _detectron_predictor


def get_checkpoint_path(save_dir, weights_arg=None):
    """
    Devuelve la ruta del checkpoint a cargar.
    - Si se pasa --weights, usa ese.
    - Si no, busca el último *.ckpt en save_dir.
    """
    if weights_arg is not None:
        return Path(weights_arg)

    save_dir = Path(save_dir)
    ckpts = sorted(save_dir.glob("*.ckpt"))
    if not ckpts:
        raise FileNotFoundError(f"No se encontraron checkpoints en {save_dir}")
    # último por orden alfabético (normalmente el de mayor epoch/steps)
    return ckpts[-1]

def run_detectron_on_image(img_path):
    """
    Ejecuta Detectron sobre la imagen y devuelve:
      - bbox del mejor objeto como [x1, y1, x2, y2]
      - score
    Si no hay detecciones, devuelve (None, None)
    """
    predictor = get_detectron_predictor()
    im = cv2.imread(img_path)
    if im is None:
        print(f"[Detectron] No se pudo leer la imagen: {img_path}")
        return None, None

    outputs = predictor(im)
    instances = outputs["instances"].to("cpu")
    if len(instances) == 0:
        print("[Detectron] Sin detecciones")
        return None, None

    scores = instances.scores
    boxes = instances.pred_boxes.tensor.numpy()

    best_idx = scores.argmax().item()
    best_box = boxes[best_idx]  # [x1, y1, x2, y2]
    best_score = scores[best_idx].item()

    return best_box, best_score

# ==============================================


def predict_image(model, img_path):
    """
    Muestra una ventana con:
    - Mapa de calor Grad-CAM del clasificador
    - BBox de Detectron dibujada encima
    """
    model.eval()
    model.to('cpu')  # usamos CPU para GradCAM

    # 1) Cargar imagen original
    image = Image.open(img_path).convert('RGB')
    transformed_image = default_transform(image).unsqueeze(0)

    # 2) GradCAM sobre layer3
    cam_extractor = GradCAM(model.model, target_layer="layer3")

    transformed_image = transformed_image.requires_grad_(True)
    output = model(transformed_image)
    _, predicted_class = torch.max(output, 1)
    print(f"[Classifier] Predicted Class: {predicted_class.item()}")

    # 3) Calcular mapa de activación
    cam_map = cam_extractor(predicted_class.item(), output)[0]
    cam_extractor.clear_hooks()

    # 4) Overlay: imagen original + heatmap
    heatmap = overlay_mask(
        image,  # imagen original
        to_pil_image(cam_map, mode='F'),
        alpha=0.5
    )

    # 5) Ejecutar Detectron y dibujar su bbox sobre el heatmap
    bbox, score = run_detectron_on_image(img_path)
    if bbox is not None:
        x1, y1, x2, y2 = bbox
        draw = ImageDraw.Draw(heatmap)
        # rectángulo rojo con grosor 3
        for offset in range(3):
            draw.rectangle(
                [x1 - offset, y1 - offset, x2 + offset, y2 + offset],
                outline="red"
            )
        print(f"[Detectron] Detección con score={score:.3f}")

    # 6) Mostrar resultado combinado
    plt.imshow(heatmap)
    plt.axis('off')
    plt.show()


def create_api(model):
    """
    API Flask que devuelve:
    - predicted_class
    - activation_map (Grad-CAM) en base64
    (Aquí NO he metido Detectron para no complicarlo; si quieres también se puede añadir)
    """
    app = Flask(__name__)
    CORS(app, resources={r"/*": {"origins": "*"}})

    @app.route('/predict', methods=['POST'])
    def predict():
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400

        file = request.files['file']
        try:
            image = Image.open(file).convert('RGB')
            transformed_image = default_transform(image).unsqueeze(0)

            cam_extractor = GradCAM(model.model, target_layer="layer3")

            transformed_image = transformed_image.requires_grad_(True)
            output = model(transformed_image)
            _, predicted_class = torch.max(output, 1)

            cam_map = cam_extractor(predicted_class.item(), output)[0]
            cam_extractor.clear_hooks()

            overlay_result = overlay_mask(
                image,
                to_pil_image(cam_map, mode='F'),
                alpha=0.5
            )

            overlay_result = resize_overlay(overlay_result, image.size)

            overlay_image_path = "activation_map.png"
            overlay_result.save(overlay_image_path)

            with open(overlay_image_path, "rb") as img_file:
                encoded_image = base64.b64encode(img_file.read()).decode('utf-8')

            return jsonify({
                'predicted_class': int(predicted_class.item()),
                'activation_map': encoded_image
            })
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    return app


def resize_overlay(overlay, original_shape):
    return overlay.resize(original_shape, Image.Resampling.BILINEAR)


def main():
    global num_classes

    parser = argparse.ArgumentParser(
        description="Train, evaluate, predict, or run an API using an image classifier."
    )
    parser.add_argument(
        "-c", "--command",
        type=str,
        required=True,
        choices=["train", "evaluate", "predict", "api"],
        help="Command to execute."
    )
    parser.add_argument(
        "-a", "--annotations",
        type=str,
        help="Path to JSON file containing images and class IDs."
    )
    parser.add_argument(
        "-d", "--img_dir",
        type=str,
        help="Directory containing images."
    )
    parser.add_argument(
        "--max_epochs",
        type=int,
        default=100,
        help="Maximum number of training epochs."
    )
    parser.add_argument(
        "--patience",
        type=int,
        default=10,
        help="Patience for early stopping."
    )
    parser.add_argument(
        "--save_dir",
        type=str,
        default=save_dir_default,
        help="Directory to save TensorBoard data and checkpoints."
    )
    parser.add_argument(
        "-i", "--input_image",
        type=str,
        help="Path to input image for prediction."
    )
    parser.add_argument(
        "-w", "--weights",
        type=str,
        help="Path to checkpoint for loading weights."
    )

    args = parser.parse_args()

    if args.command == "train":
        if not args.annotations or not os.path.exists(args.annotations):
            raise FileNotFoundError(f"Annotations file not found: {args.annotations}")
        if not args.img_dir or not os.path.isdir(args.img_dir):
            raise NotADirectoryError(f"Image directory not found: {args.img_dir}")
        dataset = JSONImageDataset(args.annotations, args.img_dir)
        dataloader = DataLoader(dataset, batch_size=128, shuffle=True)

        num_classes = len(set(item['class_id'] for item in dataset.data))
        if num_classes < 2:
            raise ValueError(f"Dataset must contain at least 2 classes, found {num_classes}.")

        if args.weights:
            model = ImageClassifier.load_from_checkpoint(args.weights, num_classes=num_classes)
            print(f"Resuming training from checkpoint: {args.weights}")
        else:
            model = ImageClassifier(num_classes)

        early_stopping = EarlyStopping(monitor='train_loss', patience=args.patience, mode='min')
        checkpoint_callback = ModelCheckpoint(
            dirpath=args.save_dir,
            monitor='train_loss',
            mode='min',
            save_top_k=3,
            every_n_epochs=2
        )

        trainer = pl.Trainer(
            max_epochs=args.max_epochs,
            callbacks=[early_stopping, checkpoint_callback],
            default_root_dir=args.save_dir
        )

        trainer.fit(model, dataloader)

    elif args.command == "evaluate":
        dataset = JSONImageDataset(args.annotations, args.img_dir)
        dataloader = DataLoader(dataset, batch_size=32, shuffle=False)

        checkpoint_path = get_checkpoint_path(args.save_dir, args.weights)
        print(f"Loading checkpoint from: {checkpoint_path}")
        model = ImageClassifier.load_from_checkpoint(checkpoint_path)

        evaluate_model(model, dataloader)

    elif args.command == "predict":
        checkpoint_path = get_checkpoint_path(args.save_dir, args.weights)
        print(f"Loading checkpoint from: {checkpoint_path}")
        model = ImageClassifier.load_from_checkpoint(checkpoint_path).to('cpu')

        predict_image(model, args.input_image)

    elif args.command == "api":
        checkpoint_path = get_checkpoint_path(args.save_dir, args.weights)
        print(f"Loading checkpoint from: {checkpoint_path}")
        model = ImageClassifier.load_from_checkpoint(checkpoint_path).to('cpu')
        app = create_api(model)
        serve(app, host='0.0.0.0', port=API_PORT)


if __name__ == "__main__":
    main()
