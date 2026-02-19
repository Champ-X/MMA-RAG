# OpenRouter

API 文档：https://openrouter.ai/docs/api/

| Model                         | Input Modalities       | Output Modalities | type                    | Max Context |
| ----------------------------- | ---------------------- | ----------------- | ----------------------- | ----------- |
| qwen/qwen3-embedding-8b       | Text                   | Embeddings        | embeddings              | 32,000      |
| google/gemini-3-flash-preview | Text,Image,Audio,Video | Text              | chat,vision,aduio,video | 1,048,576   |
| google/gemini-2.5-flash       | Text,Image,Audio,Video | Text              | chat,vision,aduio,video | 1,048,576   |
| google/gemini-3-pro-preview   | Text,Image,Audio,Video | Text              | chat,vision,aduio,video | 1,048,576   |
| qwen/qwen3.5-plus-02-15       | Text,Image,Video       | Text              | chat,vision,video       | 1,000,000   |
| qwen/qwen3.5-397b-a17b        | Text,Image,Video       | Text              | chat,vision,video       | 262,144     |
| qwen/qwen-plus                | Text                   | Text              | chat                    | 1,000,000   |
| openai/gpt-5.2-chat           | Text,Image             | Text              | chat,vision             | 128,000     |

# AliyunBailian

API 文档：https://bailian.console.aliyun.com/cn-beijing?tab=api#/api/?type=model&url=2712576

| Model                        | Input Modalities       | Output Modalities | type                    | Max Context |
| ---------------------------- | ---------------------- | ----------------- | ----------------------- | ----------- |
| qwen3.5-plus                 | Text,Image,Video       | Text              | chat,vision,video       | 991K        |
| qwen3.5-397b-a17b            | Text,Image,Video       | Text              | chat,vision,video       | 254k        |
| qwen3-max                    | Text                   | Text              | chat                    | 252k        |
| qwen3-vl-rerank              |                        |                   | reranker                | 800k        |
| qwen3-rerank                 |                        |                   | reranker                | 30k         |
| text-embedding-v4            | Text                   | Embeddings        | embeddings              | 32k         |
| qwen3-vl-embedding           | Text,Image             | Embeddings        | embeddings              | 32k         |
| qwen3-omni-30b-a3b-captioner | Audio                  | Text              | aduio                   | 32k         |
| qwen3-vl-flash               | Text,Image,Video       | Text              | chat,vision,video       | 30k         |
| qwen3-vl-plus                | Text,Image,Video       | Text              | chat,vision,video       | 30k         |
| qwen3-omni-flash             | Text,Image,Audio,Video | Text,Audio        | chat,vision,aduio,video | 48k         |
| qwen-omni-turbo              | Text,Image,Audio,Video | Text,Audio        | chat,vision,aduio,video | 30k         |