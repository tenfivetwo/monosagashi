# このフォルダのモデルについて

`dinov2-small-quantized.onnx` は、画像の特徴を取り出す AI モデル DINOv2（small）です。

## 出どころ

| 項目 | 内容 |
|---|---|
| 元のモデル | DINOv2 small（Meta Platforms, Inc.）<br>https://github.com/facebookresearch/dinov2<br>https://huggingface.co/facebook/dinov2-small |
| 使っている版 | onnx-community が ONNX 形式に変換し、量子化（軽量化）した版<br>https://huggingface.co/onnx-community/dinov2-small の `onnx/model_quantized.onnx`（取得時のリビジョン `8b1f705a3a7f6f062f6bdd21986c1583d3ef105d`） |
| 取得日 | 2026-11-06 |
| SHA-256 | `C179F8F7F592449C4C1BCA4CD124A7538021428C5FFB89AFDE9503935B197EFB` |
| このアプリでの変更 | ファイル名を `dinov2-small-quantized.onnx` に変えただけ。中身はそのまま |

`config.json` と `preprocessor_config.json` も同じ onnx-community の版から取得したもので、内容は変えていません。

## ライセンス

元の DINOv2 は Apache License 2.0 で公開されています。全文は同じフォルダの [LICENSE](LICENSE) にあります（facebookresearch/dinov2 のリポジトリから取得）。

onnx-community の変換版のページにはライセンスの記載がないため、元のモデルの Apache License 2.0 に従って扱っています。

論文：Oquab et al., "DINOv2: Learning Robust Visual Features without Supervision", 2023（https://arxiv.org/abs/2304.07193）
