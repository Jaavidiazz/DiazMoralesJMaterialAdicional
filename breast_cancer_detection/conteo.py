#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
conteo.py

- Cuenta benignas, malignas y normales en los datasets originales:
  INBreast, CBIS-DDSM y MIAS.
- Calcula cuántas imágenes serán procesadas por el conversor dadas las clases elegidas
  (por defecto: mass + calcification) y cuántas son benignas/malignas.
- Arreglado para INBreast: se usa el "prefijo base" (antes del primer '-') para
  cruzar DICOM, XML y CSV (BI-RADS).

Uso:
  python conteo.py \
    --datasets inbreast cbis-ddsm mias \
    --classes mass calcification \
    --inbreast-dir "datasets/INbreast Release 1.0" \
    --cbis-dir "datasets/CBIS-DDSM" \
    --mias-dir "datasets/all-mias"
"""

import os
import re
import ast
from pathlib import Path
from csv import DictReader
import argparse
import numpy as np
import pandas as pd
import cv2
from pydicom import dcmread
import xmltodict

DEFAULT_DATASETS = ['inbreast', 'cbis-ddsm', 'mias']
DEFAULT_CLASSES = ['mass', 'calcification']  # para procesar TODO lo benigno/maligno
BBOX_LENGTH_THRESHOLD = 0.005

# MIAS: ampliar tipos de masas
MIAS_TYPES_FOR_MASS = {'CIRC', 'SPIC', 'MISC', 'ARCH', 'ASYM'}

def normalize(pixel_array):
    pixel_range = pixel_array.max() - pixel_array.min()
    if pixel_range == 0:
        return np.zeros_like(pixel_array, dtype=np.float32)
    return (pixel_array - pixel_array.min()) / pixel_range

def normalize_with_threshold(pixel_array, threshold=(1000, 2000)):
    arr = pixel_array.copy()
    arr[arr < threshold[0]] = threshold[0]
    arr[arr > threshold[1]] = threshold[1]
    return normalize(arr)

def bbox_from_polygon_rel(roi_xy, img_w, img_h):
    roi = np.asarray(roi_xy, dtype=np.float32)
    xs = roi[:, 0] / float(img_w)
    ys = roi[:, 1] / float(img_h)
    xc, yc = xs.mean(), ys.mean()
    bw, bh = xs.max() - xs.min(), ys.max() - ys.min()
    return (float(xc), float(yc), float(bw), float(bh))

def valid_rel_bbox(b, thresh=BBOX_LENGTH_THRESHOLD):
    xc, yc, w, h = b
    if any(v > 1.0 or v < 0.0 for v in (xc, yc, w, h)):
        return False
    if w < thresh or h < thresh:
        return False
    return True

# ---------------- INBreast ----------------

def stats_inbreast(inbreast_dir, chosen_classes):
    xml_dir = os.path.join(inbreast_dir, 'AllXML')
    dcm_dir = os.path.join(inbreast_dir, 'AllDICOMs')
    csv_path = os.path.join(inbreast_dir, 'INbreast.csv')

    # BI-RADS por prefijo base
    df = pd.read_csv(csv_path, sep=';')
    birads = {}
    for filename, score in zip(df['File Name'].astype(str), df['Bi-Rads'].astype(str)):
        base = Path(filename.strip()).stem.split('-')[0]  # prefijo base
        score_num = int(re.sub(r'\D', '', score))  # 4a,4b,4c -> 4
        birads[base] = score_num

    # DICOMs presentes (en prefijo base)
    dicoms_base = {Path(p).stem.split('-')[0] for p in Path(dcm_dir).glob('*.dcm')}

    xml_paths = list(Path(xml_dir).glob('*.xml'))
    original = {'benignas': 0, 'malignas': 0, 'normales': 0}
    to_process = {'total': 0, 'benignas': 0, 'malignas': 0}

    has_lesion_any = set()

    for x in xml_paths:
        stem = x.stem  # INBreast XML ya suele ser prefijo base
        with open(x, 'r') as f:
            xml_data = f.read()
        xml_dict = xmltodict.parse(xml_data)
        entries = xml_dict['plist']['dict']['array']['dict']['array']['dict']
        if not isinstance(entries, list):
            entries = [entries]

        lesion_in_xml = False
        chosen_rois = {c: [] for c in chosen_classes}

        for entry in entries:
            class_name = entry['string'][1]
            class_name = class_name.lower() if class_name else None
            if class_name:
                lesion_in_xml = True

            if class_name in chosen_classes:
                roi = entry['array'][1]['string']
                if isinstance(roi, list):
                    roi = [ast.literal_eval(pt) for pt in roi]
                elif isinstance(roi, str):
                    roi = ast.literal_eval(roi)
                if isinstance(roi, list) and len(roi) > 2:
                    chosen_rois[class_name].append(np.asarray(roi, dtype=np.int32))

        if lesion_in_xml:
            has_lesion_any.add(stem)

        if any(len(v) for v in chosen_rois.values()) and stem in birads:
            # encontrar un DICOM que empiece por stem (prefijo base)
            cand = list(Path(dcm_dir).glob(f"{stem}*.dcm"))
            if not cand:
                continue
            dcm_path = str(cand[0])

            try:
                ds = dcmread(dcm_path)
                arr = ds.pixel_array
                h, w = arr.shape[:2]
            except Exception:
                continue

            passes = False
            for cls in chosen_rois:
                for roi in chosen_rois[cls]:
                    b = bbox_from_polygon_rel(roi, w, h)
                    if valid_rel_bbox(b):
                        passes = True
                        break
                if passes:
                    break

            if passes:
                to_process['total'] += 1
                if birads[stem] >= 4:
                    to_process['malignas'] += 1
                else:
                    to_process['benignas'] += 1

    # Conteo original (benignas/malignas si hay lesión + BI-RADS; normales si no)
    for base in dicoms_base:
        if base in has_lesion_any and base in birads:
            if birads[base] >= 4:
                original['malignas'] += 1
            else:
                original['benignas'] += 1
        else:
            original['normales'] += 1

    return original, to_process

# ---------------- CBIS-DDSM ----------------

def stats_cbis(cbis_dir, chosen_classes):
    csv_dir = os.path.join(cbis_dir, 'csv')
    jpeg_dir = os.path.join(cbis_dir, 'jpeg')

    dcm_info_path = os.path.join(csv_dir, 'dicom_info.csv')
    dcm_jpeg = {}
    with open(dcm_info_path, 'r') as f:
        for row in DictReader(f):
            if 'crop' in row['SeriesDescription']:
                continue
            dcm_path = Path(row['file_path'].strip()).parent.parts[-1]
            jpeg_path = os.path.join(*Path(row['image_path'].strip()).parts[-2:])
            dcm_jpeg[dcm_path] = jpeg_path

    csv_names = [
        'calc_case_description_train_set.csv',
        'calc_case_description_test_set.csv',
        'mass_case_description_test_set.csv',
        'mass_case_description_train_set.csv'
    ]

    original = {'benignas': 0, 'malignas': 0, 'normales': 0}
    to_process = {'total': 0, 'benignas': 0, 'malignas': 0}

    image_to_masks = {}

    for csv_name in csv_names:
        path = os.path.join(csv_dir, csv_name)
        with open(path, 'r') as f:
            for row in DictReader(f):
                class_name = 'calcification' if csv_name.startswith('calc') else 'mass'
                assess = int(str(row['assessment']).strip())

                if assess >= 4:
                    original['malignas'] += 1
                else:
                    original['benignas'] += 1

                if class_name not in chosen_classes:
                    continue

                img_parent = Path(row['image file path'].strip()).parent.parts[-1]
                if img_parent not in dcm_jpeg:
                    continue
                jpeg_rel = dcm_jpeg[img_parent]

                mask_parent = Path(row['ROI mask file path'].strip()).parent.parts[-1]
                if mask_parent not in dcm_jpeg:
                    continue
                mask_rel = dcm_jpeg[mask_parent]

                image_to_masks.setdefault(jpeg_rel, []).append((mask_rel, class_name, assess))

    for jpeg_rel, items in image_to_masks.items():
        mask_has_valid = False
        final_label = None
        for mask_rel, class_name, assess in items:
            mask_path = os.path.join(jpeg_dir, mask_rel)
            mask = cv2.imread(mask_path, cv2.IMREAD_GRAYSCALE)
            if mask is None:
                continue
            _, thr = cv2.threshold(mask, 127, 255, cv2.THRESH_BINARY)
            contours, _ = cv2.findContours(thr, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            for cnt in contours:
                cnt = np.array(cnt).reshape(-1, 2)
                xs = cnt[:, 0] / mask.shape[1]
                ys = cnt[:, 1] / mask.shape[0]
                bbox = (float(xs.mean()), float(ys.mean()),
                        float(xs.max() - xs.min()), float(ys.max() - ys.min()))
                if bbox[2] <= 1 and bbox[3] <= 1 and bbox[2] >= BBOX_LENGTH_THRESHOLD and bbox[3] >= BBOX_LENGTH_THRESHOLD:
                    mask_has_valid = True
                    final_label = 'malignas' if assess >= 4 else 'benignas'
                    break
            if mask_has_valid:
                break

        if mask_has_valid:
            to_process['total'] += 1
            to_process[final_label] += 1

    return original, to_process

# ---------------- MIAS ----------------

def stats_mias(mias_dir, chosen_classes):
    info_path = os.path.join(mias_dir, 'Info.txt')

    original = {'benignas': 0, 'malignas': 0, 'normales': 0}
    to_process = {'total': 0, 'benignas': 0, 'malignas': 0}

    with open(info_path, 'r') as f:
        lines = [ln.strip() for ln in f if ln.startswith('mdb')]

    for line in lines:
        parts = line.split()
        if len(parts) < 3:
            continue

        if parts[2] == 'NORM':
            original['normales'] += 1
            continue

        if len(parts) >= 4:
            tipo = parts[2]         # CIRC, SPIC, MISC, ARCH, ASYM, CALC, ...
            mb = parts[3].upper()   # 'M' o 'B'
            label = 'malignas' if mb == 'M' else 'benignas'
            original[label] += 1

            # Solo masas (como en tu convert), pero ampliamos tipos
            if 'mass' in chosen_classes and tipo in MIAS_TYPES_FOR_MASS:
                to_process['total'] += 1
                to_process[label] += 1
        else:
            continue

    return original, to_process

def main():
    ap = argparse.ArgumentParser(description="Estadísticas de datasets (original vs a procesar)")
    ap.add_argument("--datasets", nargs="+", default=DEFAULT_DATASETS,
                    choices=['inbreast', 'cbis-ddsm', 'mias'])
    ap.add_argument("--classes", nargs="+", default=DEFAULT_CLASSES,
                    choices=['mass', 'calcification'])
    ap.add_argument("--inbreast-dir", default=os.path.join('datasets', 'INbreast Release 1.0'))
    ap.add_argument("--cbis-dir", default=os.path.join('datasets', 'CBIS-DDSM'))
    ap.add_argument("--mias-dir", default=os.path.join('datasets', 'all-mias'))
    args = ap.parse_args()

    totals_original = {'benignas': 0, 'malignas': 0, 'normales': 0}
    totals_process = {'total': 0, 'benignas': 0, 'malignas': 0}

    print("== Estadísticas por dataset ==")

    if 'inbreast' in args.datasets:
        o, p = stats_inbreast(args.inbreast_dir, args.classes)
        print("\n[INBreast]")
        print(f"Original -> Benignas: {o['benignas']}, Malignas: {o['malignas']}, Normales: {o['normales']}")
        print(f"A procesar -> Total: {p['total']} (Benignas: {p['benignas']}, Malignas: {p['malignas']})")
        for k in totals_original: totals_original[k] += o[k]
        for k in totals_process: totals_process[k] += p[k]

    if 'cbis-ddsm' in args.datasets:
        o, p = stats_cbis(args.cbis_dir, args.classes)
        print("\n[CBIS-DDSM]")
        print(f"Original -> Benignas: {o['benignas']}, Malignas: {o['malignas']}, Normales: {o['normales']}")
        print(f"A procesar -> Total: {p['total']} (Benignas: {p['benignas']}, Malignas: {p['malignas']})")
        for k in totals_original: totals_original[k] += o[k]
        for k in totals_process: totals_process[k] += p[k]

    if 'mias' in args.datasets:
        o, p = stats_mias(args.mias_dir, args.classes)
        print("\n[MIAS]")
        print(f"Original -> Benignas: {o['benignas']}, Malignas: {o['malignas']}, Normales: {o['normales']}")
        print(f"A procesar -> Total: {p['total']} (Benignas: {p['benignas']}, Malignas: {p['malignas']})")
        for k in totals_original: totals_original[k] += o[k]
        for k in totals_process: totals_process[k] += p[k]

    print("\n== Totales globales ==")
    print(f"Original -> Benignas: {totals_original['benignas']}, "
          f"Malignas: {totals_original['malignas']}, "
          f"Normales: {totals_original['normales']}")
    print(f"A procesar -> Total: {totals_process['total']} "
          f"(Benignas: {totals_process['benignas']}, Malignas: {totals_process['malignas']})")

if __name__ == "__main__":
    main()
