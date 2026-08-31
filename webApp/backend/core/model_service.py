import os
from typing import Optional

import cv2
import torch
import numpy as np
from PIL import Image

from detectron2.config import get_cfg
from detectron2.engine import DefaultPredictor
from detectron2.utils.visualizer import Visualizer, ColorMode
from detectron2.data import MetadataCatalog

from core.config import CFG_PATH, WEIGHTS_PATH
from core.security import ensure_image_exists

metadata = MetadataCatalog.get("breast_inference")
metadata.set(thing_classes=["benigna", "maligna"])

CLASS_ID_TO_NAME = {
    0: "mass_low",
    1: "mass_high",
}

TARGET_LAYER_PATH = "backbone.bottom_up.res5.2.conv3"

predictor: Optional[DefaultPredictor] = None


def load_predictor() -> Optional[DefaultPredictor]:
    if not os.path.exists(CFG_PATH):
        print(f"[WARN] No existe {CFG_PATH}")
        return None

    if not os.path.exists(WEIGHTS_PATH):
        print(f"[WARN] No existe {WEIGHTS_PATH}")
        return None

    cfg = get_cfg()
    cfg.merge_from_file(CFG_PATH)

    cfg.defrost()
    cfg.MODEL.WEIGHTS = WEIGHTS_PATH
    cfg.MODEL.DEVICE = "cpu"
    cfg.MODEL.ROI_HEADS.SCORE_THRESH_TEST = 0.5
    cfg.freeze()

    return DefaultPredictor(cfg)


def get_predictor() -> Optional[DefaultPredictor]:
    return predictor


def reload_predictor() -> Optional[DefaultPredictor]:
    """Recarga el predictor global desde CFG_PATH/WEIGHTS_PATH (usado tras subir un modelo nuevo)."""
    global predictor
    predictor = load_predictor()
    return predictor


predictor = load_predictor()


def predecir_mama(image_or_case) -> dict:
    if predictor is None:
        raise RuntimeError("El predictor Detectron2 no está cargado")

    if isinstance(image_or_case, Image.Image):
        pil_img = image_or_case.convert("RGB")
    elif isinstance(image_or_case, dict):
        image_path = ensure_image_exists(image_or_case.get("image_url"))
        pil_img = Image.open(image_path).convert("RGB")
    else:
        raise TypeError("predecir_mama espera una PIL.Image o un dict con image_url")

    img = np.array(pil_img)[:, :, ::-1]

    with torch.no_grad():
        outputs = predictor(img)

    instances = outputs["instances"]
    num_inst = int(len(instances))

    if num_inst == 0:
        return {
            "clasificacion": "normal",
            "prob_maligna": 0.0,
            "confidence": 0.8,
            "raw_outputs": {
                "num_instances": 0,
                "main_class_name": None,
            },
        }

    classes = instances.pred_classes.cpu().numpy()
    scores = instances.scores.cpu().numpy()

    max_idx = int(np.argmax(scores))
    top_cls = int(classes[max_idx])
    top_score = float(scores[max_idx])

    clasificacion = "maligna" if top_cls == 1 else "benigna"
    malignant_scores = [float(s) for s, cls in zip(scores, classes) if cls == 1]
    prob_maligna = max(malignant_scores) if malignant_scores else 0.0
    main_class_name = CLASS_ID_TO_NAME.get(top_cls, str(top_cls))

    return {
        "clasificacion": str(clasificacion),
        "prob_maligna": float(prob_maligna),
        "confidence": float(top_score),
        "raw_outputs": {
            "num_instances": int(num_inst),
            "main_class_name": str(main_class_name),
        },
    }


def generar_overlay(image_path: str, overlay_path: str):
    if predictor is None:
        raise RuntimeError("El predictor Detectron2 no está cargado")

    if not os.path.exists(image_path):
        raise RuntimeError(f"No se encontró la imagen original: {image_path}")

    img_bgr = cv2.imread(image_path)
    if img_bgr is None:
        raise RuntimeError(f"No se pudo leer la imagen con OpenCV: {image_path}")

    with torch.no_grad():
        outputs = predictor(img_bgr)

    v = Visualizer(
        img_bgr[:, :, ::-1],
        metadata=metadata,
        scale=1.0,
        instance_mode=ColorMode.IMAGE,
    )
    out = v.draw_instance_predictions(outputs["instances"].to("cpu"))
    vis_rgb = out.get_image()
    vis_bgr = vis_rgb[:, :, ::-1]
    cv2.imwrite(overlay_path, vis_bgr)


def _get_target_module(model, layer_path: str):
    module = model
    for attr in layer_path.split("."):
        if attr.isdigit():
            module = module[int(attr)]
        else:
            module = getattr(module, attr)
    return module


def _compute_gradcam_with_predictor(
    predictor: DefaultPredictor,
    image_bgr,
    target_layer_path: str,
):
    model = predictor.model
    model.eval()
    device = model.device

    h, w = image_bgr.shape[:2]

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

    activations = {}
    target_module = _get_target_module(model, target_layer_path)

    def fwd_hook(module, inp, out):
        activations["value"] = out

    handle_fwd = target_module.register_forward_hook(fwd_hook)

    with torch.enable_grad():
        outputs = model([inputs])[0]

    instances = outputs["instances"]
    if len(instances) == 0:
        handle_fwd.remove()
        return None, None, None

    scores = instances.scores
    boxes = instances.pred_boxes.tensor

    best_idx = scores.argmax().item()
    best_score = scores[best_idx].item()
    best_box = boxes[best_idx].detach().cpu().numpy()

    if "value" not in activations:
        handle_fwd.remove()
        return None, None, None

    acts = activations["value"]
    target_score = scores[best_idx]

    model.zero_grad()
    grads = torch.autograd.grad(
        outputs=target_score,
        inputs=acts,
        retain_graph=True,
    )[0]

    weights = grads.mean(dim=(2, 3), keepdim=True)
    cam = (weights * acts).sum(dim=1, keepdim=True)
    cam = torch.relu(cam)
    cam = cam[0, 0].detach().cpu().numpy()

    cam = cv2.resize(cam, (w, h))
    cam -= cam.min()
    cam /= (cam.max() + 1e-8)

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
    handle_fwd.remove()

    return cam, best_box, best_score


def generar_mapa_calor(image_path: str, heatmap_path: str):
    if predictor is None:
        raise RuntimeError("El predictor Detectron2 no está cargado")

    if not os.path.exists(image_path):
        raise RuntimeError(f"No se encontró la imagen original: {image_path}")

    img_bgr = cv2.imread(image_path)
    if img_bgr is None:
        raise RuntimeError(f"No se pudo leer la imagen con OpenCV: {image_path}")

    cam, best_box, best_score = _compute_gradcam_with_predictor(
        predictor=predictor,
        image_bgr=img_bgr,
        target_layer_path=TARGET_LAYER_PATH,
    )

    if cam is None:
        return

    H, W = img_bgr.shape[:2]
    cam_resized = cv2.resize(cam, (W, H))

    heat_uint8 = np.uint8(cam_resized * 255)
    heat_color = cv2.applyColorMap(heat_uint8, cv2.COLORMAP_JET)

    heat_bgra = cv2.cvtColor(heat_color, cv2.COLOR_BGR2BGRA)
    heat_bgra[:, :, 3] = heat_uint8

    os.makedirs(os.path.dirname(heatmap_path), exist_ok=True)
    cv2.imwrite(heatmap_path, heat_bgra)
