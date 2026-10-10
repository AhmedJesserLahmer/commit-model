# Third-party notices

The MIT license in `LICENSE` covers this extension's own code. The extension doesn't bundle the
following; it downloads them on first start, and they keep their own licenses:

- **The model**, [`Jess2005/commit-model-CLI`](https://huggingface.co/Jess2005/commit-model-CLI): a
  fine-tune of **Qwen2.5-Coder-1.5B-Instruct** (Alibaba Cloud, Apache License 2.0,
  https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct) on **CommitBench** (Maximilian Schall et al.,
  CC BY-NC 4.0, https://huggingface.co/datasets/Maxscha/commitbench). Because of CommitBench's license,
  the model is for **non-commercial use**.
- **llama.cpp** (`llama-server`), https://github.com/ggml-org/llama.cpp, MIT License.
- On Windows, if missing: the **Microsoft Visual C++ Redistributable**, installed with your permission
  from Microsoft (https://aka.ms/vs/17/release/vc_redist.x64.exe) under Microsoft's license terms.
