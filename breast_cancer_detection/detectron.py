#!/usr/bin/env python
# Train Faster R-CNN model using Detectron

# ================== CPU-ONLY PATCH (poner al inicio) ==================
import os

os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")  # Oculta cualquier GPU (PyTorch verá solo CPU)

try:
    import torch
    torch.backends.cuda.matmul.allow_tf32 = False
    if hasattr(torch, "set_num_threads"):
        torch.set_num_threads(max(1, os.cpu_count() // 2))
except Exception:
    pass

# Monkey-patch global de Detectron2 para que DefaultTrainer/DefaultPredictor usen CPU SIEMPRE
try:
    from detectron2.engine import defaults as _d2_defaults

    _OriginalDefaultTrainer = _d2_defaults.DefaultTrainer
    _OriginalDefaultPredictor = _d2_defaults.DefaultPredictor

    class _CPUDefaultTrainer(_OriginalDefaultTrainer):
        @classmethod
        def build_model(cls, cfg):
            if cfg.is_frozen():
                cfg.defrost()
            cfg.MODEL.DEVICE = "cpu"
            if hasattr(cfg, "SOLVER") and hasattr(cfg.SOLVER, "AMP"):
                cfg.SOLVER.AMP.ENABLED = False
            cfg.freeze()
            model = super().build_model(cfg)
            return model

    class _CPUDefaultPredictor(_OriginalDefaultPredictor):
        def __init__(self, cfg):
            if cfg.is_frozen():
                cfg.defrost()
            cfg.MODEL.DEVICE = "cpu"
            if hasattr(cfg, "SOLVER") and hasattr(cfg.SOLVER, "AMP"):
                cfg.SOLVER.AMP.ENABLED = False
            cfg.freeze()
            super().__init__(cfg)

    _d2_defaults.DefaultTrainer = _CPUDefaultTrainer
    _d2_defaults.DefaultPredictor = _CPUDefaultPredictor

    DefaultTrainer = _CPUDefaultTrainer
    DefaultPredictor = _CPUDefaultPredictor
except Exception:
    pass
# =====================================================================

import json
import random
import sys
from argparse import ArgumentParser
from collections import defaultdict
from pathlib import Path
import cv2
import matplotlib.pyplot as plt
import numpy as np
import torch  # reimport seguro
from cloudpickle import pickle
from detectron2 import model_zoo
from detectron2.config import get_cfg
from detectron2.data import DatasetCatalog, MetadataCatalog
from detectron2.data import build_detection_test_loader, build_detection_train_loader
from detectron2.data import transforms as T
from detectron2.data.datasets.coco import load_coco_json
from detectron2.engine import DefaultTrainer, DefaultPredictor  # ya parcheados arriba
from detectron2.evaluation import COCOEvaluator, inference_on_dataset
from detectron2.modeling import build_model
from matplotlib.patches import Rectangle
from matplotlib.widgets import Slider, Button
from sklearn.metrics import precision_recall_curve
from torchvision.ops import box_iou
from filters import ImageFilterProcessor
from detectron2.engine import HookBase
from detectron2.data import DatasetMapper

# --- Parameters --- #
# Entrenamiento
checkpoint_period = 20       # nº de checkpoints intermedios a lo largo del entrenamiento
batch_size = 4
num_workers = 0              # macOS va mejor con 0
pretrained = True
cb_only = False              # True si solo quieres CBIS-DDSM
seed = 42                    # semilla para reproducibilidad

# Rutas COCO
coco_json = {'train': 'train.json', 'val': 'val.json', 'test': 'test.json'}
coco_image = {'train': 'train/images', 'val': 'val/images', 'test': 'test/images'}
yaml_config = "COCO-Detection/faster_rcnn_R_50_FPN_3x.yaml"
pretrained_weights_path = "detectron2://COCO-Detection/faster_rcnn_R_50_FPN_3x/137849458/model_final_280758.pkl"
cfg_output = "detectron.cfg.yaml"
dataset_yaml = 'dataset.yaml'
yolo_paths = {
    'labels': 'labels',
    'images': 'images'
}
# --- End of Parameters #

def load_ground_truth(dataset_path, file_name, format='coco'):
    if dataset_path is None:
        return [], []

    if format == 'coco':
        with open(dataset_path) as f:
            data = json.load(f)
        image_entry = next((img for img in data['images'] if img['file_name'] == file_name), None)
        if image_entry is None:
            print(f"Image with file name '{file_name}' not found in dataset.", file=sys.stderr)
            return None
        image_id = image_entry['id']
        annotations = [ann for ann in data['annotations'] if ann['image_id'] == image_id]
        gt_boxes = [ann['bbox'] for ann in annotations]
        gt_classes = [ann['category_id'] for ann in annotations]
        return gt_boxes, gt_classes

    elif format == 'yolo':
        gt_boxes, gt_classes = [], []
        label_file = os.path.join(dataset_path, f"{os.path.splitext(file_name)[0]}.txt")
        if not os.path.exists(label_file):
            raise ValueError(f"Label file '{label_file}' not found for image '{file_name}'.")
        with open(label_file, 'r') as f:
            for line in f.readlines():
                cls, x_center, y_center, width, height = map(float, line.split())
                gt_classes.append(int(cls))
                x1 = x_center - width / 2
                y1 = y_center - height / 2
                gt_boxes.append([x1, y1, width, height])
        return gt_boxes, gt_classes
    else:
        raise ValueError("Unsupported format. Use 'coco' or 'yolo'.")

def get_dataset_path(image_path, coco_json):
    for split in ('train', 'test', 'val'):
        if f'{split}/' in image_path:
            return coco_json[split]
    return None

# Globals para visualización
slider, show_labels, show_gt, has_gt = None, True, False, False
gt_boxes, gt_classes = [], []

def visualize_predictions(image, predictions, dataset_path=None, file_name=None, format='coco',
                          confidence_threshold=0.5):
    global slider, show_labels, show_gt, has_gt, gt_boxes, gt_classes
    pred_boxes = predictions['instances'].pred_boxes.tensor.cpu().numpy()
    scores = predictions['instances'].scores.cpu().numpy()
    pred_classes = predictions['instances'].pred_classes.cpu().numpy()

    has_gt = False
    if dataset_path and file_name:
        loaded_gt = load_ground_truth(dataset_path, file_name, format)
        if loaded_gt:
            gt_boxes, gt_classes = loaded_gt
            has_gt = True

    fig, ax = plt.subplots(1, figsize=(12, 8))
    plt.subplots_adjust(left=0.1, bottom=0.25)
    ax.imshow(image)

    def update(val):
        global gt_boxes, gt_classes
        threshold = slider.val
        ax.clear()
        keep = scores >= threshold
        filtered_boxes = pred_boxes[keep]
        filtered_scores = scores[keep]
        filtered_classes = pred_classes[keep]
        ax.imshow(image)
        for box, score, cls in zip(filtered_boxes, filtered_scores, filtered_classes):
            x1, y1, x2, y2 = box
            width, height = x2 - x1, y2 - y1
            rect = Rectangle((x1, y1), width, height, linewidth=2, edgecolor='r', facecolor='none')
            ax.add_patch(rect)
            if show_labels:
                ax.text(x1, y1, f'Class: {cls}, Score: {score:.2f}', color='yellow', fontsize=12,
                        verticalalignment='top')
        if show_gt and has_gt:
            for gt_box, gt_cls in zip(gt_boxes, gt_classes):
                x1, y1, width, height = gt_box
                rect = Rectangle((x1, y1), width, height, linewidth=2, edgecolor='g', facecolor='none')
                ax.add_patch(rect)
                ax.text(x1, y1, f'GT Class: {gt_cls}', color='green', fontsize='medium', verticalalignment='top')
        plt.draw()

    initial_threshold = confidence_threshold
    ax_slider = plt.axes([0.1, 0.1, 0.8, 0.05], facecolor='lightgray')
    slider = Slider(ax_slider, 'Confidence', 0, 1, valinit=initial_threshold)
    slider.on_changed(update)

    ax_toggle_labels = plt.axes([0.81, 0.03, 0.1, 0.05])
    toggle_button_labels = Button(ax_toggle_labels, 'Toggle Labels')

    def toggle_labels(event):
        global show_labels
        show_labels = not show_labels
        update(None)

    toggle_button_labels.on_clicked(toggle_labels)

    if has_gt:
        ax_toggle_gt = plt.axes([0.68, 0.03, 0.1, 0.05])
        toggle_button_gt = Button(ax_toggle_gt, 'Toggle Truth')

        def toggle_gt(event):
            global show_gt
            show_gt = not show_gt
            update(None)

        toggle_button_gt.on_clicked(toggle_gt)

    update(initial_threshold)
    plt.show()

class LossEvalHook(HookBase):
    """Calcula la loss de validacion cada `eval_period` iteraciones y la
    registra en el storage como "validation_loss", para que
    EarlyStoppingHook/BestCheckpointHook tengan una metrica real que leer."""

    def __init__(self, eval_period, model, data_loader):
        self._model = model
        self._period = eval_period
        self._data_loader = data_loader

    def _get_loss(self, data):
        with torch.no_grad():
            metrics_dict = self._model(data)
        metrics_dict = {
            k: v.detach().cpu().item() if isinstance(v, torch.Tensor) else float(v)
            for k, v in metrics_dict.items()
        }
        return sum(metrics_dict.values())

    def _do_loss_eval(self):
        losses = [self._get_loss(inputs) for inputs in self._data_loader]
        mean_loss = float(np.mean(losses)) if losses else float("inf")
        self.trainer.storage.put_scalar("validation_loss", mean_loss)
        return mean_loss

    def after_step(self):
        next_iter = self.trainer.iter + 1
        is_final = next_iter == self.trainer.max_iter
        if self._period > 0 and (is_final or next_iter % self._period == 0):
            self._do_loss_eval()

class EarlyStoppingHook(HookBase):
    def __init__(self, patience=10, metric_name="validation_loss", eval_period=1):
        self.patience = patience
        self.metric_name = metric_name
        self.eval_period = eval_period
        self.best_metric = float("inf")
        self.counter = 0

    def after_step(self):
        next_iter = self.trainer.iter + 1
        if self.eval_period > 0 and next_iter % self.eval_period != 0:
            return
        storage = self.trainer.storage
        current_metric = storage.latest().get(self.metric_name, None)
        if current_metric is not None:
            current_metric = current_metric[0] if isinstance(current_metric, tuple) else current_metric
            if current_metric < self.best_metric:
                self.best_metric = current_metric
                self.counter = 0
            else:
                self.counter += 1
            if self.counter >= self.patience:
                print("Early stopping triggered.")
                self.trainer._shutdown = True

class BestCheckpointHook(HookBase):
    def __init__(self, metric_name="validation_loss", output_dir="./output", eval_period=1):
        self.metric_name = metric_name
        self.eval_period = eval_period
        self.best_metric = float("inf")
        self.output_dir = output_dir

    def after_step(self):
        next_iter = self.trainer.iter + 1
        if self.eval_period > 0 and next_iter % self.eval_period != 0:
            return
        storage = self.trainer.storage
        current_metric = storage.latest().get(self.metric_name, None)
        if current_metric is not None:
            current_metric = current_metric[0] if isinstance(current_metric, tuple) else current_metric
            if current_metric < self.best_metric:
                self.best_metric = current_metric
                self.trainer.checkpointer.save("best_model")

def _force_cpu_cfg(cfg):
    if cfg.is_frozen():
        cfg.defrost()
    cfg.MODEL.DEVICE = "cpu"
    if hasattr(cfg, "SOLVER") and hasattr(cfg.SOLVER, "AMP"):
        cfg.SOLVER.AMP.ENABLED = False
    cfg.freeze()


class AugmentedTrainer(DefaultTrainer):
    """DefaultTrainer con más variedad en el train loader (además de resize +
    flip horizontal, ya presentes por defecto): brillo y contraste
    aleatorios. Con un dataset de ~1400 imágenes reales, entrenar muchas
    iteraciones sin esta variedad hace que el modelo memorice las imágenes
    en vez de generalizar (ver CHANGELOG.md, sobreajuste tras iter ~2000 en
    el entrenamiento sin augmentation)."""

    @classmethod
    def build_train_loader(cls, cfg):
        augs = [
            T.ResizeShortestEdge(
                cfg.INPUT.MIN_SIZE_TRAIN,
                cfg.INPUT.MAX_SIZE_TRAIN,
                cfg.INPUT.MIN_SIZE_TRAIN_SAMPLING,
            ),
            T.RandomFlip(horizontal=True, vertical=False),
            T.RandomBrightness(0.8, 1.2),
            T.RandomContrast(0.8, 1.2),
        ]
        mapper = DatasetMapper(cfg, is_train=True, augmentations=augs)
        return build_detection_train_loader(cfg, mapper=mapper)


def train(cfg, parsed=None):
    if cfg.is_frozen():
        cfg.defrost()

    # --- Always CPU & no-AMP ---
    cfg.MODEL.DEVICE = "cpu"
    if hasattr(cfg, "SOLVER") and hasattr(cfg.SOLVER, "AMP"):
        cfg.SOLVER.AMP.ENABLED = False

    # --- Fast mode toggle ---
    fast = True
    if parsed is not None and hasattr(parsed, "fast"):
        fast = parsed.fast

    # Scheduler con decaimiento real: sin esto el LR se queda constante todo
    # el entrenamiento, que es peor para converger bien en tiradas largas.
    cfg.SOLVER.LR_SCHEDULER_NAME = "WarmupMultiStepLR"
    cfg.SOLVER.STEPS = [int(cfg.SOLVER.MAX_ITER * 0.6), int(cfg.SOLVER.MAX_ITER * 0.85)]
    cfg.SOLVER.GAMMA = 0.1
    cfg.SOLVER.WARMUP_ITERS = 100

    # Grad clipping
    cfg.SOLVER.CLIP_GRADIENTS.ENABLED = True
    cfg.SOLVER.CLIP_GRADIENTS.CLIP_TYPE = "value"
    cfg.SOLVER.CLIP_GRADIENTS.CLIP_VALUE = 1.0

    # Tamaño de imagen y recortes para acelerar
    if fast:
        # Resoluciones más pequeñas
        cfg.INPUT.MIN_SIZE_TRAIN = (400, 500, 600)
        cfg.INPUT.MAX_SIZE_TRAIN = 800
        cfg.INPUT.MIN_SIZE_TEST = 600
        cfg.INPUT.MAX_SIZE_TEST = 800

        # RPN: menos propuestas
        cfg.MODEL.RPN.PRE_NMS_TOPK_TRAIN = 600
        cfg.MODEL.RPN.POST_NMS_TOPK_TRAIN = 100
        cfg.MODEL.RPN.PRE_NMS_TOPK_TEST = 1000
        cfg.MODEL.RPN.POST_NMS_TOPK_TEST = 100

        # ROI HEADS: menos muestras por imagen
        cfg.MODEL.ROI_HEADS.BATCH_SIZE_PER_IMAGE = 128

    cfg.freeze()

    trainer = AugmentedTrainer(cfg)

    # Loader de un solo paso sobre "val" pero con mapper de entrenamiento
    # (incluye anotaciones) para poder calcular la loss real de validacion.
    val_loader = build_detection_test_loader(
        cfg,
        cfg.DATASETS.TEST[0],
        mapper=DatasetMapper(cfg, is_train=True),
    )
    eval_period = cfg.TEST.EVAL_PERIOD if cfg.TEST.EVAL_PERIOD > 0 else 300

    trainer.register_hooks([
        LossEvalHook(eval_period, trainer.model, val_loader),
        EarlyStoppingHook(patience=10, metric_name="validation_loss", eval_period=eval_period),
        BestCheckpointHook(metric_name="validation_loss", output_dir=cfg.OUTPUT_DIR, eval_period=eval_period)
    ])

    resume_flag = getattr(parsed, "resume", False)
    if cfg.MODEL.WEIGHTS or (parsed and parsed.weights_path):
        if parsed and parsed.weights_path:
            if cfg.is_frozen():
                cfg.defrost()
            cfg.MODEL.WEIGHTS = parsed.weights_path
            cfg.freeze()
        trainer.resume_or_load(resume=resume_flag)
    else:
        trainer.resume_or_load(resume=resume_flag)

    trainer.train()

def predict(cfg, parsed, visualize=True):
    _force_cpu_cfg(cfg)

    image_path = parsed.image_path if parsed.image_path else input("Enter image path: ")
    weights_path = parsed.weights_path if parsed.weights_path else input("Enter weights path: ")

    if cfg.is_frozen():
        cfg.defrost()
    cfg.MODEL.WEIGHTS = weights_path
    cfg.freeze()

    predictor = DefaultPredictor(cfg)
    image = cv2.imread(image_path)

    if hasattr(parsed, 'filter') and parsed.filter:
        processor = ImageFilterProcessor()
        image = processor.apply_filter(parsed.filter, image)
        if image is not None and len(image.shape) == 2:
            image = np.stack((image,) * 3, axis=-1)

    if image is None:
        raise FileNotFoundError(f"Cannot read image at path: {image_path}")

    predictions = predictor(image)

    if visualize:
        dataset_path = get_dataset_path(image_path, coco_json)
        if dataset_path and os.path.exists(dataset_path):
            file_name = Path(image_path).parts[-1]
            visualize_predictions(image, predictions, dataset_path=dataset_path, file_name=file_name)
        else:
            visualize_predictions(image, predictions)

    return predictions

def evaluate_test_to_coco(cfg, parsed=None):
    _force_cpu_cfg(cfg)

    weights_path = parsed.weights_path if parsed and parsed.weights_path else input("Enter weights path: ")

    if cfg.is_frozen():
        cfg.defrost()
    cfg.MODEL.WEIGHTS = weights_path
    cfg.freeze()

    predictor = DefaultPredictor(cfg)
    image_dir = coco_image['test']

    results_json = {
        "images": [],
        "annotations": [],
        "categories": [{"id": i, "name": str(i)} for i in range(len(MetadataCatalog.get(cfg.DATASETS.TRAIN[0]).thing_classes))],
    }

    image_ids = []
    image_id_to_name = {}
    with open(coco_json['test']) as f:
        test_json = json.load(f)
        for image in test_json['images']:
            image_ids.append(image['id'])
            image_id_to_name.update({image['id']: image['file_name']})

    for image_id in image_ids:
        image_name = image_id_to_name[image_id]
        image_path = os.path.join(image_dir, image_name)
        image = cv2.imread(str(image_path))
        if image is None:
            continue

        predictions = predictor(image)
        pred_boxes = predictions['instances'].pred_boxes.tensor.cpu().numpy()
        scores = predictions['instances'].scores.cpu().numpy()
        pred_classes = predictions['instances'].pred_classes.cpu().numpy()

        results_json['images'].append({
            "id": image_id,
            "file_name": image_name,
            "width": image.shape[1],
            "height": image.shape[0],
        })

        for box, score, cls in zip(pred_boxes, scores, pred_classes):
            x1, y1, x2, y2 = box
            results_json['annotations'].append({
                "id": len(results_json['annotations']) + 1,
                "image_id": image_id,
                "category_id": int(cls),
                "bbox": [float(x1), float(y1), float(x2 - x1), float(y2 - y1)],
                "score": float(score),
            })

    output_json_path = parsed.output_path if parsed and parsed.output_path else "predictions.json"
    with open(output_json_path, 'w') as json_file:
        json.dump(results_json, json_file, indent=4)

    print(f"Predictions saved to {output_json_path}")

def compute_ap(precision, recall):
    mrec = np.concatenate(([0.], recall, [1.]))
    mpre = np.concatenate(([0.], precision, [0.]))
    for i in range(mpre.size - 1, 0, -1):
        mpre[i - 1] = np.maximum(mpre[i - 1], mpre[i])
    i = np.where(mrec[1:] != mrec[:-1])[0]
    ap = np.sum((mrec[i + 1] - mrec[i]) * mpre[i + 1])
    return ap

def evaluate(cfg, parsed=None, dataset_name="test"):
    _force_cpu_cfg(cfg)

    if cfg.is_frozen():
        cfg.defrost()
    cfg.DATASETS.TEST = (dataset_name,)
    cfg.freeze()

    weights_path = parsed.weights_path if parsed and parsed.weights_path else input("Enter weights path: ")

    if cfg.is_frozen():
        cfg.defrost()
    cfg.MODEL.WEIGHTS = weights_path
    cfg.freeze()

    if dataset_name not in DatasetCatalog.list():
        raise ValueError(f"Dataset '{dataset_name}' is not registered.")

    evaluator = COCOEvaluator(dataset_name, cfg, False, output_dir="./output/")
    test_loader = build_detection_test_loader(cfg, dataset_name)
    predictor = DefaultPredictor(cfg)

    all_ground_truths = defaultdict(list)
    all_predictions = defaultdict(list)
    class_counts = defaultdict(int)

    for inputs in test_loader:
        image_id = inputs[0]["image_id"]
        annotations = DatasetCatalog.get(dataset_name)[image_id].get("annotations", [])

        x_ratio = inputs[0]['image'].shape[2] / inputs[0]['width']
        y_ratio = inputs[0]['image'].shape[1] / inputs[0]['height']

        for ann in annotations:
            class_id = ann["category_id"]
            x, y, w, h = ann["bbox"]
            x *= x_ratio
            y *= y_ratio
            w *= x_ratio
            h *= y_ratio
            all_ground_truths[class_id].append({"bbox": [x, y, x + w, y + h], "used": False})
            class_counts[class_id] += 1

        outputs = predictor(np.transpose(inputs[0]["image"].numpy(), (1, 2, 0)))
        pred_boxes = outputs["instances"].pred_boxes.tensor.cpu().numpy()
        scores = outputs["instances"].scores.cpu().numpy()
        pred_classes = outputs["instances"].pred_classes.cpu().numpy()

        for box, score, pred_class in zip(pred_boxes, scores, pred_classes):
            all_predictions[pred_class].append({"bbox": box, "score": score})

    results = inference_on_dataset(predictor.model, test_loader, evaluator)
    print("Detectron2 evaluation results:")
    print(results)

    class_ap = {}
    for class_id in all_ground_truths.keys():
        gt = all_ground_truths[class_id]
        pred = sorted(all_predictions[class_id], key=lambda x: x["score"], reverse=True)

        nd = len(pred)
        tp = np.zeros(nd)
        fp = np.zeros(nd)

        for i, prediction in enumerate(pred):
            ovmax = -np.inf
            gt_match = -1

            for j, gt_box in enumerate(gt):
                if gt_box["used"]:
                    continue
                iou = compute_iou(prediction["bbox"], gt_box["bbox"])
                if iou > ovmax:
                    ovmax = iou
                    gt_match = j

            if ovmax >= 0.5:
                if not gt[gt_match]["used"]:
                    tp[i] = 1
                    gt[gt_match]["used"] = True
                else:
                    fp[i] = 1
            else:
                fp[i] = 1

        fp = np.cumsum(fp)
        tp = np.cumsum(tp)
        rec = tp / float(len(gt)) if len(gt) > 0 else np.array([0.0]*len(tp))
        prec = tp / np.maximum(tp + fp, np.finfo(np.float64).eps)

        ap = compute_ap(prec, rec) if len(gt) > 0 else 0.0
        class_ap[class_id] = ap

    mAP = np.mean(list(class_ap.values())) if class_ap else 0.0

    print("\nPer-class Average Precision:")
    for class_id, ap in class_ap.items():
        print(f"Class {class_id}: AP = {ap:.4f}")

    print(f"\nOverall mAP: {mAP:.4f}")

    return results, class_ap, mAP

def compute_iou(box1, box2):
    x1, y1, x2, y2 = box1
    x3, y3, x4, y4 = box2

    xi1 = max(x1, x3)
    yi1 = max(y1, y3)
    xi2 = min(x2, x4)
    yi2 = min(y2, y4)

    inter_area = max(xi2 - xi1, 0) * max(yi2 - yi1, 0)

    box1_area = (x2 - x1) * (y2 - y1)
    box2_area = (x4 - x3) * (y4 - y3)

    union_area = box1_area + box2_area - inter_area

    iou = inter_area / union_area if union_area > 0 else 0
    return iou

def compute_precision_recall(ground_truths, predictions, iou_threshold=0.5):
    all_true_labels = []
    all_scores = []

    for gt, pred in zip(ground_truths, predictions):
        gt_boxes = torch.tensor(gt["boxes"], dtype=torch.float32)
        pred_boxes = torch.tensor(pred["boxes"], dtype=torch.float32)
        pred_scores = torch.tensor(pred["scores"], dtype=torch.float32)

        if len(gt_boxes) == 0 or len(pred_boxes) == 0:
            true_labels = torch.zeros(len(pred_boxes), dtype=bool)
            all_true_labels.extend(true_labels.tolist())
            all_scores.extend(pred_scores.tolist())
            continue

        iou_matrix = box_iou(pred_boxes, gt_boxes)
        true_labels = torch.zeros(len(pred_boxes), dtype=bool)
        for i in range(len(pred_boxes)):
            max_iou = iou_matrix[i].max().item()
            if max_iou >= iou_threshold:
                true_labels[i] = True
        all_true_labels.extend(true_labels.tolist())
        all_scores.extend(pred_scores.tolist())

    all_true_labels = np.array(all_true_labels)
    all_scores = np.array(all_scores)
    precision, recall, thresholds = precision_recall_curve(all_true_labels, all_scores)
    return precision, recall, thresholds

def load_and_filter_dataset(json_file, image_root, dataset_name, filter_cb=False):
    loaded_dataset = load_coco_json(json_file=json_file,
                                    image_root=image_root,
                                    dataset_name=dataset_name)
    if filter_cb:
        print("Filtering CBIS-DDSM for", dataset_name)
        filtered_dataset = [
            entry for entry in loaded_dataset
            if os.path.basename(entry["file_name"]).startswith("cb")
        ]
        return filtered_dataset
    return loaded_dataset

def balance_coco_dataset(dataset, cat0=0, cat1=1, max_per_class=None):
    """
    Devuelve una versión BALANCEADA del dataset COCO cargado en Detectron2.

    Parámetros:
    - dataset: lista de detectron2 (cada entrada tiene "annotations" y "image_id")
    - cat0, cat1: IDs de las dos clases a balancear
    - max_per_class: opcional → si no lo pasas, se usa el mínimo entre ambas clases

    Retorna:
    - lista de entries balanceados
    """

    # Listas separadas por clase
    class0_items = []
    class1_items = []

    for entry in dataset:
        anns = entry.get("annotations", [])
        cats = {ann["category_id"] for ann in anns}

        # imagen que contiene la clase 0
        if cat0 in cats:
            class0_items.append(entry)
        # imagen que contiene la clase 1
        if cat1 in cats:
            class1_items.append(entry)

    print(f"[Balance] Clase 0: {len(class0_items)} imágenes")
    print(f"[Balance] Clase 1: {len(class1_items)} imágenes")

    # número final por clase: por defecto, la clase MAYORITARIA (sobremuestreo
    # de la minoritaria repitiendo imágenes) en vez de la minoritaria
    # (submuestreo, que antes descartaba imágenes reales de la clase mayor).
    if max_per_class is None:
        n = max(len(class0_items), len(class1_items))
    else:
        n = max_per_class

    print(f"[Balance] Usando {n} imágenes por clase (sobremuestreo si hace falta)")

    def _take_oversampled(items, n):
        if not items:
            return []
        reps = (n + len(items) - 1) // len(items)
        return (items * reps)[:n]

    class0_items = _take_oversampled(class0_items, n)
    class1_items = _take_oversampled(class1_items, n)

    balanced = class0_items + class1_items
    print(f"[Balance] Dataset final → {len(balanced)} imágenes")

    return balanced


def export_model(cfg, parsed=None):
    _force_cpu_cfg(cfg)
    if cfg.is_frozen():
        cfg.defrost()
    cfg.MODEL.WEIGHTS = parsed.weights_path if parsed and parsed.weights_path else input("Enter weights path: ")
    cfg.freeze()

    output_path = parsed.output_path if parsed and parsed.output_path else 'detectron_as_pytorch_model_output.pkl'
    model = build_model(cfg)
    with open(output_path, 'wb') as f:
        pickle.dump(model, f)
    print("Current model saved to:", output_path)

choices_map = {
    'train': train,
    'predict': predict,
    'evaluate': evaluate,
    'evaluate_test_to_coco': evaluate_test_to_coco,
    'export_model': export_model
}
choices = choices_map.keys()

def main():
    global pretrained_weights_path

    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)

    filter_processor = ImageFilterProcessor()
    filters_list = filter_processor.filters.keys()

    argparser = ArgumentParser()
    argparser.add_argument('-c', '--choice',
                           help="Modes of program: train, predict, evaluate, evaluate_test_to_coco, export_model",
                           type=str)
    argparser.add_argument('-i', '--image-path', type=str)
    argparser.add_argument('-f', '--filter', type=str, choices=filters_list)
    argparser.add_argument('-w', '--weights-path', type=str)
    argparser.add_argument('-o', '--output-path', type=str)
    argparser.add_argument('--resume', action='store_true', help="Resume training from last checkpoint")
    # FAST toggle: por defecto True para bajar ETA
    fast_default = False
    argparser.add_argument('--fast', dest='fast', action='store_true', default=fast_default,
                           help='Modo rápido (≈ 1–2h en CPU).')
    argparser.add_argument('--no-fast', dest='fast', action='store_false',
                           help='Desactiva el modo rápido (entrenamiento completo y más lento).')
    argparser.add_argument('--max-iter', dest='max_iter', type=int, default=None,
                           help='Fuerza cfg.SOLVER.MAX_ITER a este valor, ignorando el nº por defecto de --fast/--no-fast.')
    parsed = argparser.parse_args()

    choice = None
    if parsed.choice:
        choice = parsed.choice.lower()

    while choice not in choices:
        choice = (input("Enter mode (train, evaluate, predict, evaluate_test_to_coco, export_model): ")
                  .lower())

    keys_json = list(coco_json.keys())
    keys_json.sort()
    keys_image = list(coco_image.keys())
    keys_image.sort()
    if keys_json != ['test', 'train', 'val'] or keys_image != keys_json:
        raise Exception("coco_json")

    for dataset_name in keys_json:
        loaded_dataset = load_and_filter_dataset(
            json_file=coco_json[dataset_name],
            image_root=coco_image[dataset_name],
            dataset_name=dataset_name,
            filter_cb=cb_only
        )

        # === AUXILIAR PARA ENTRENAMIENTO BALANCEADO ===
        if dataset_name == "train":
            print("\n== BALANCEANDO DATASET DE ENTRENAMIENTO ==")
            loaded_dataset = balance_coco_dataset(
                loaded_dataset,
                cat0=0,
                cat1=1
            )
            print("== FIN BALANCEO ==\n")
        # ===============================================

        print(f"[Dataset] {dataset_name}: {len(loaded_dataset)} imagenes")

        DatasetCatalog.register(dataset_name, lambda d=loaded_dataset: d)

    # Config base
    cfg = get_cfg()
    cfg.merge_from_file(model_zoo.get_config_file(yaml_config))
    cfg.DATASETS.TRAIN = ("train",)
    cfg.DATASETS.TEST = ("val",)
    # Periodos más frecuentes para ver progreso en rápido
    cfg.TEST.EVAL_PERIOD = 300 if parsed.fast else 500

    if pretrained:
        cfg.MODEL.WEIGHTS = pretrained_weights_path
    else:
        cfg.MODEL.WEIGHTS = ""

    cfg.DATALOADER.NUM_WORKERS = num_workers
    cfg.SOLVER.IMS_PER_BATCH = batch_size
    cfg.SOLVER.BASE_LR = 0.0005  # un poco mayor para menos iteraciones
    # Checkpoint/Epochs efectivos

    # Modo rápido: ~1–2h en CPU (según comentabas), 1800 iters.
    # Modo largo (no-fast): ~7h aprox -> subimos a unas 7200 iters (4x).
    if parsed.max_iter:
        cfg.SOLVER.MAX_ITER = parsed.max_iter
    elif parsed.fast:
        cfg.SOLVER.MAX_ITER = 1800
    else:
        cfg.SOLVER.MAX_ITER = 2500  # ajustable: si ves que se queda corto/largo, sube o baja este número

    cfg.SOLVER.CHECKPOINT_PERIOD = max(100, int(cfg.SOLVER.MAX_ITER / max(1, checkpoint_period)))
    cfg.MODEL.ROI_HEADS.NUM_CLASSES = len(MetadataCatalog.get("train").thing_classes)

    # Forzar CPU y no-AMP
    _force_cpu_cfg(cfg)

    # YAML en vez de pickle: evita deserializacion insegura al cargar el cfg
    # en produccion (webApp/backend) y es legible/versionable.
    with open(cfg_output, 'w') as f:
        f.write(cfg.dump())

    os.makedirs(cfg.OUTPUT_DIR, exist_ok=True)
    choices_map[choice](cfg, parsed)

if __name__ == '__main__':
    main()
