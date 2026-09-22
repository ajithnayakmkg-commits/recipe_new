"""
train_yolo.py
-------------
OPTIONAL. Fine-tunes YOLOv8 on a custom fridge-ingredient dataset so the
detector recognises Indian kitchen items that COCO does not know
(paneer, curry leaves, dal and so on).

Steps
  1. Collect or download a labelled dataset. Roboflow Universe has several
     free "fridge ingredients" / "food ingredients" datasets in YOLO format.
  2. Put it in backend/dataset/ with this layout:
        dataset/images/train, dataset/images/val
        dataset/labels/train, dataset/labels/val
        dataset/data.yaml
  3. pip install ultralytics
  4. python train_yolo.py
  5. Copy runs/detect/train/weights/best.pt to backend/models/best.pt

detector.py picks up models/best.pt automatically the next time you start
the server.
"""

from ultralytics import YOLO

DATA_YAML = "dataset/data.yaml"
EPOCHS = 50
IMAGE_SIZE = 640

if __name__ == "__main__":
    model = YOLO("yolov8n.pt")          # small, trains on a laptop GPU or Colab
    model.train(
        data=DATA_YAML,
        epochs=EPOCHS,
        imgsz=IMAGE_SIZE,
        batch=16,
        patience=10,
        name="fridge-ingredients",
    )
    metrics = model.val()
    print("mAP50    :", metrics.box.map50)
    print("mAP50-95 :", metrics.box.map)
