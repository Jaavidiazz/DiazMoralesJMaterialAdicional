#!/usr/bin/env python
# -*- coding: utf-8 -*-

import os
import json
import argparse
import time
import numpy as np
import matplotlib.pyplot as plt
import cv2

from sklearn.metrics import confusion_matrix, ConfusionMatrixDisplay

from detectron2.config import get_cfg
from detectron2.engine import DefaultPredictor
from detectron2.data.datasets import register_coco_instances
from detectron2.data import MetadataCatalog, DatasetCatalog
from detectron2 import model_zoo


def unique_dataset_name(base: str) -> str:
    """
    Devuelve un nombre único si 'base' ya está registrado.
    Evita conflictos de registro entre ejecuciones.
    """
    existing = set(DatasetCatalog.list())
    if base not in existing:
        return base
    # Sufijo con pid y timestamp
    return f"{base}_{os.getpid()}_{int(time.time())}"


def safe_register_coco(base_name: str, json_path: str, image_root: str) -> str:
    """
    Registra el dataset COCO. Si el nombre ya existe, crea uno único.
    Devuelve el nombre finalmente registrado.
    """
    name = unique_dataset_name(base_name)
    register_coco_instances(name, {}, json_path, image_root)
    # No tocamos MetadataCatalog para evitar conflictos.
    _ = MetadataCatalog.get(name)
    return name


def build_cfg(weights_path: str, num_classes: int, device: str = "cpu"):
    cfg = get_cfg()
    cfg.merge_from_file(model_zoo.get_config_file(
        "COCO-Detection/faster_rcnn_R_50_FPN_3x.yaml"
    ))
    cfg.MODEL.ROI_HEADS.NUM_CLASSES = num_classes
    cfg.MODEL.WEIGHTS = weights_path
    cfg.MODEL.DEVICE = device
    # Inferencia “permisiva” para no perder muestras por score
    cfg.MODEL.ROI_HEADS.SCORE_THRESH_TEST = 0.0
    cfg.TEST.DETECTIONS_PER_IMAGE = 100
    return cfg


def load_thing_classes_from_json(json_path: str):
    with open(json_path, "r") as f:
        data = json.load(f)
    cats = sorted(data.get("categories", []), key=lambda c: c["id"])
    if not cats:
        raise RuntimeError(f"No hay categorías en {json_path}")
    # Solo para mostrar (no se fija en el catálogo)
    return [str(c.get("name", c.get("id"))) for c in cats], len(cats)


def collect_confusion_for_split(
    base_split_name: str,
    json_path: str,
    image_root: str,
    predictor: DefaultPredictor,
    num_classes: int,
    min_score: float = 0.05
):
    """
    Devuelve (y_true, y_pred) por imagen:
      - GT = clase mayoritaria de sus anotaciones
      - Pred = clase de la detección con mayor score (>= min_score)
    """
    split_name = safe_register_coco(base_split_name, json_path, image_root)
    dataset_dicts = DatasetCatalog.get(split_name)

    y_true, y_pred = [], []

    for d in dataset_dicts:
        im = cv2.imread(d["file_name"])
        if im is None:
            continue

        # Detectron2 espera BGR, cv2 ya carga en BGR
        outputs = predictor(im)
        instances = outputs["instances"].to("cpu")

        gt_classes = [a["category_id"] for a in d.get("annotations", [])]
        if len(gt_classes) == 0:
            # sin GT, no computamos
            continue

        pred_classes = instances.pred_classes.numpy() if instances.has("pred_classes") else np.array([])
        pred_scores = instances.scores.numpy() if instances.has("scores") else np.array([])

        # umbral de confianza
        keep = pred_scores >= min_score
        pred_classes = pred_classes[keep]
        pred_scores = pred_scores[keep]

        if len(pred_classes) == 0:
            # sin predicciones por encima del umbral, ignoramos la imagen
            continue

        # GT por imagen: clase mayoritaria
        gt_class = int(np.bincount(np.array(gt_classes)).argmax())
        # Pred por imagen: la de mayor score
        pred_class = int(pred_classes[np.argmax(pred_scores)])

        if 0 <= gt_class < num_classes and 0 <= pred_class < num_classes:
            y_true.append(gt_class)
            y_pred.append(pred_class)

    return y_true, y_pred


def plot_and_print_cm(cm, labels_for_display, title):
    disp = ConfusionMatrixDisplay(confusion_matrix=cm, display_labels=labels_for_display)
    disp.plot(cmap=plt.cm.Blues, xticks_rotation=45, colorbar=True)
    plt.title(title)
    plt.tight_layout()
    plt.show()
    print(f"\n{title}")
    print("Clases (orden):", labels_for_display)
    print("Matriz (filas=GT, columnas=Pred):\n", cm)


def main():
    ap = argparse.ArgumentParser(
        description="Matriz de confusión global (train+test [+val]) sin re-entrenar"
    )
    ap.add_argument("--train_json", default="train.json", help="Ruta a train.json")
    ap.add_argument("--train_images", default="train/images", help="Ruta a train/images")
    ap.add_argument("--test_json", default="test.json", help="Ruta a test.json")
    ap.add_argument("--test_images", default="test/images", help="Ruta a test/images")
    ap.add_argument("--val_json", default="", help="(Opcional) Ruta a val.json")
    ap.add_argument("--val_images", default="", help="(Opcional) Ruta a val/images")
    ap.add_argument("--use_val", action="store_true", help="Incluir val en la matriz global")
    ap.add_argument("--weights", default="output/model_final.pth", help="Pesos del modelo (.pth)")
    ap.add_argument("--min_score", type=float, default=0.05, help="Score mínimo para contar predicciones")
    ap.add_argument("--display_labels", default="",
                    help="Etiquetas de visualización separadas por comas. Deben coincidir en cantidad.")
    args = ap.parse_args()

    # Clases desde el JSON de train (solo para rotular e inferir nº de clases)
    thing_classes, num_classes = load_thing_classes_from_json(args.train_json)

    # Etiquetas de display opcionales
    if args.display_labels.strip():
        display_labels = [s.strip() for s in args.display_labels.split(",")]
        if len(display_labels) != num_classes:
            print("[Aviso] --display_labels no coincide con el nº de clases. Se usarán las del JSON.")
            display_labels = thing_classes
    else:
        display_labels = thing_classes

    # Predictor en CPU con tus pesos
    cfg = build_cfg(args.weights, num_classes=num_classes, device="cpu")
    predictor = DefaultPredictor(cfg)

    # --- TRAIN ---
    y_true_train, y_pred_train = collect_confusion_for_split(
        "mammo_train",
        args.train_json,
        args.train_images,
        predictor,
        num_classes,
        min_score=args.min_score
    )

    # --- TEST ---
    y_true_test, y_pred_test = collect_confusion_for_split(
        "mammo_test",
        args.test_json,
        args.test_images,
        predictor,
        num_classes,
        min_score=args.min_score
    )

    # --- VAL opcional ---
    y_true_val, y_pred_val = [], []
    if args.use_val and args.val_json and args.val_images:
        y_true_val, y_pred_val = collect_confusion_for_split(
            "mammo_val",
            args.val_json,
            args.val_images,
            predictor,
            num_classes,
            min_score=args.min_score
        )
    elif args.use_val:
        print("[Aviso] --use_val está activo pero faltan --val_json/--val_images. Se ignora VAL.")

    labels_idx = list(range(num_classes))

    # Matrices por split
    if y_true_train and y_pred_train:
        cm_train = confusion_matrix(y_true_train, y_pred_train, labels=labels_idx)
        plot_and_print_cm(cm_train, display_labels, "Matriz de confusión - TRAIN")
    else:
        print("[Aviso] No se pudo construir matriz para TRAIN (¿umbral muy alto o rutas erróneas?).")

    if y_true_test and y_pred_test:
        cm_test = confusion_matrix(y_true_test, y_pred_test, labels=labels_idx)
        plot_and_print_cm(cm_test, display_labels, "Matriz de confusión - TEST")
    else:
        print("[Aviso] No se pudo construir matriz para TEST (¿umbral muy alto o rutas erróneas?).")

    if args.use_val and y_true_val and y_pred_val:
        cm_val = confusion_matrix(y_true_val, y_pred_val, labels=labels_idx)
        plot_and_print_cm(cm_val, display_labels, "Matriz de confusión - VAL")

    # Global (train + test [+ val])
    y_true_global = y_true_train + y_true_test + (y_true_val if args.use_val else [])
    y_pred_global = y_pred_train + y_pred_test + (y_pred_val if args.use_val else [])

    if y_true_global and y_pred_global:
        cm_global = confusion_matrix(y_true_global, y_pred_global, labels=labels_idx)
        plot_and_print_cm(cm_global, display_labels, "Matriz de confusión - GLOBAL (TRAIN+TEST{})".format(
            "+VAL" if (args.use_val and y_true_val and y_pred_val) else ""
        ))
    else:
        print("[Aviso] No se pudo construir la matriz GLOBAL.")


if __name__ == "__main__":
    main()
