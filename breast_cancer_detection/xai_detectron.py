#!/usr/bin/env python
"""
Grad-CAM sobre Detectron2 (Faster R-CNN R50-FPN).

Muestra:
- Imagen original con el mapa de calor Grad-CAM superpuesto
- NO dibuja la bbox (solo el heatmap)

Uso:
    python xai_detectron.py -i ruta/a/imagen.png
"""

import os
import argparse

import cv2
import matplotlib.pyplot as plt
import numpy as np
import torch
from cloudpickle import pickle  # para cargar detectron.cfg.pkl

from detectron2.engine import DefaultPredictor

# ----------------- PARÁMETROS POR DEFECTO -----------------
SCRIPT_DIR = os.path.dirname(os.path.realpath(__file__))

DEFAULT_CFG_PKL = os.path.join(SCRIPT_DIR, "detectron.cfg.pkl")
DEFAULT_WEIGHTS = os.path.join(SCRIPT_DIR, "output", "model_final.pth")

# Capa típica de Grad-CAM para Faster R-CNN R50-FPN
TARGET_LAYER_PATH = "backbone.bottom_up.res5.2.conv3"
# ----------------------------------------------------------


def get_args():
    parser = argparse.ArgumentParser(description="Grad-CAM sobre Detectron2 (Faster R-CNN)")
    parser.add_argument(
        "-i", "--image",
        required=True,
        type=str,
        help="Ruta a la imagen de entrada"
    )
    parser.add_argument(
        "--cfg_pkl",
        type=str,
        default=DEFAULT_CFG_PKL,
        help=f"Ruta al cfg pickle (detectron.cfg.pkl). Default: {DEFAULT_CFG_PKL}"
    )
    parser.add_argument(
        "--weights",
        type=str,
        default=DEFAULT_WEIGHTS,
        help=f"Ruta a los pesos del modelo (model_final.pth). Default: {DEFAULT_WEIGHTS}"
    )
    parser.add_argument(
        "--score_thresh",
        type=float,
        default=0.5,
        help="Umbral mínimo de score para considerar detecciones"
    )
    parser.add_argument(
        "--device",
        type=str,
        default="cpu",
        choices=["cpu", "cuda"],
        help="Dispositivo a usar para el modelo"
    )
    return parser.parse_args()


def load_cfg_from_pickle(cfg_pkl_path, weights_path, device="cpu", score_thresh=0.5):
    if not os.path.exists(cfg_pkl_path):
        raise FileNotFoundError(f"No se encuentra el cfg pickle: {cfg_pkl_path}")
    if not os.path.exists(weights_path):
        raise FileNotFoundError(f"No se encuentran los pesos: {weights_path}")

    with open(cfg_pkl_path, "rb") as f:
        cfg = pickle.load(f)

    if cfg.is_frozen():
        cfg.defrost()
    cfg.MODEL.WEIGHTS = weights_path
    cfg.MODEL.DEVICE = device
    cfg.MODEL.ROI_HEADS.SCORE_THRESH_TEST = score_thresh
    cfg.freeze()

    return cfg


def get_target_module(model, layer_path: str):
    """
    Navega por el modelo siguiendo una ruta tipo
    'backbone.bottom_up.res5.2.conv3'
    """
    module = model
    for attr in layer_path.split("."):
        if attr.isdigit():
            module = module[int(attr)]
        else:
            module = getattr(module, attr)
    return module


def compute_gradcam_with_predictor(predictor: DefaultPredictor, image_bgr, target_layer_path: str):
    """
    Calcula Grad-CAM sobre el modelo interno de un DefaultPredictor.

    Devuelve:
        cam_norm: heatmap [0,1] del tamaño original (H,W), enmascarado a la ROI
        best_box: bbox [x1, y1, x2, y2] (np.array)
        best_score: score de la mejor detección
    """
    model = predictor.model
    model.eval()
    device = model.device

    # Imagen original
    h, w = image_bgr.shape[:2]

    # --------- Preprocesado EXACTO de DefaultPredictor ---------
    image = image_bgr
    if predictor.input_format == "RGB":
        image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

    height, width = image.shape[:2]
    image_transformed = predictor.aug.get_transform(image).apply_image(image)
    image_chw = torch.as_tensor(image_transformed.astype("float32").transpose(2, 0, 1))

    inputs = {
        "image": image_chw.to(device),
        "height": height,
        "width": width,
    }

    # ------------------- Hook de activaciones -------------------
    activations = {}

    target_module = get_target_module(model, target_layer_path)

    def fwd_hook(module, inp, out):
        # guardamos activaciones para usar luego en autograd.grad
        activations["value"] = out

    handle_fwd = target_module.register_forward_hook(fwd_hook)

    # ---------------- FORWARD + detecciones --------------------
    with torch.enable_grad():
        outputs = model([inputs])[0]

    instances = outputs["instances"]
    if len(instances) == 0:
        handle_fwd.remove()
        raise RuntimeError("No se han encontrado detecciones por encima del umbral de score.")

    scores = instances.scores
    boxes = instances.pred_boxes.tensor

    best_idx = scores.argmax().item()
    best_score = scores[best_idx].item()
    best_box = boxes[best_idx].detach().cpu().numpy()

    print(f"[Detectron] Mejor detección: score={best_score:.3f}, box={best_box.tolist()}")

    # -------------------- GRADIENTES ---------------------------
    if "value" not in activations:
        handle_fwd.remove()
        raise RuntimeError("No se capturaron activaciones en el hook. Revisa TARGET_LAYER_PATH.")

    acts = activations["value"]           # [N, C, H, W]
    target_score = scores[best_idx]

    model.zero_grad()
    # gradientes de target_score respecto a las activaciones
    grads = torch.autograd.grad(
        outputs=target_score,
        inputs=acts,
        retain_graph=True,
    )[0]                                  # [N, C, H, W]

    # -------------------- Grad-CAM -----------------------------
    # Pesos = media de gradientes sobre H,W
    weights = grads.mean(dim=(2, 3), keepdim=True)     # [N, C, 1, 1]
    cam = (weights * acts).sum(dim=1, keepdim=True)    # [N, 1, H, W]
    cam = torch.relu(cam)

    cam = cam[0, 0].detach().cpu().numpy()             # [H, W]

    # Reescalar al tamaño original (h,w)
    cam = cv2.resize(cam, (w, h))

    # Normalizar globalmente
    cam -= cam.min()
    cam /= (cam.max() + 1e-8)

    # ----------------- ENMASCARAR A LA ROI ---------------------
    x1, y1, x2, y2 = best_box.astype(int)
    h_cam, w_cam = cam.shape

    x1 = max(0, min(w_cam - 1, x1))
    x2 = max(0, min(w_cam, x2))
    y1 = max(0, min(h_cam - 1, y1))
    y2 = max(0, min(h_cam, y2))

    cam_roi = np.zeros_like(cam)
    if (y2 > y1) and (x2 > x1):
        sub = cam[y1:y2, x1:x2]
        sub = sub - sub.min()
        if sub.max() > 0:
            sub = sub / (sub.max() + 1e-8)
        cam_roi[y1:y2, x1:x2] = sub

    cam = cam_roi
    # -----------------------------------------------------------

    # Limpiar hook
    handle_fwd.remove()

    return cam, best_box, best_score


def overlay_cam_on_image(image_bgr, cam, alpha=0.5):
    """
    image_bgr: (H,W,3) BGR uint8
    cam: [0,1] (H,W)
    """
    heatmap_uint8 = np.uint8(255 * cam)
    heatmap_color = cv2.applyColorMap(heatmap_uint8, cv2.COLORMAP_JET)  # BGR
    overlay_bgr = cv2.addWeighted(image_bgr, 1 - alpha, heatmap_color, alpha, 0)
    overlay_rgb = cv2.cvtColor(overlay_bgr, cv2.COLOR_BGR2RGB)
    return overlay_rgb


def main():
    args = get_args()

    image_path = args.image
    if not os.path.exists(image_path):
        raise FileNotFoundError(f"No se encuentra la imagen: {image_path}")

    # Cargar imagen en BGR
    image_bgr = cv2.imread(image_path)
    if image_bgr is None:
        raise RuntimeError(f"No se puede leer la imagen: {image_path}")

    # 1) Cargar cfg y predictor
    cfg = load_cfg_from_pickle(
        cfg_pkl_path=args.cfg_pkl,
        weights_path=args.weights,
        device=args.device,
        score_thresh=args.score_thresh
    )

    predictor = DefaultPredictor(cfg)

    # 2) Calcular Grad-CAM sobre la mejor detección
    cam, best_box, best_score = compute_gradcam_with_predictor(
        predictor=predictor,
        image_bgr=image_bgr,
        target_layer_path=TARGET_LAYER_PATH,
    )

    # 3) Overlay (SIN dibujar bbox)
    overlay_rgb = overlay_cam_on_image(image_bgr, cam, alpha=0.5)

    fig, ax = plt.subplots(1, figsize=(6, 6))
    ax.imshow(overlay_rgb)
    ax.set_title(f"Grad-CAM Detectron | score={best_score:.3f}")
    ax.set_axis_off()
    plt.tight_layout()
    plt.show()


if __name__ == "__main__":
    main()
