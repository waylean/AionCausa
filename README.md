# AionCausa / 因时沙盘

中文 | [English](./README_EN.md)

AionCausa（因时沙盘）是一个由 AI 驱动的事件世界模拟器。你输入一个“如果”，它会先判断这个事件是否足够创建世界，再补全背景、关键假设、人物关系和因果压力，生成一个可以一幕一幕推进的小世界。

它不是简单续写故事。它更像一个事件沙盘：不同人物 Agent 带着自己的目标、恐惧、利益、记忆和局限，在同一个世界里行动、试探、结盟、对抗，最后形成新的秩序。

## 为什么做这个项目

当看到很多影视剧烂尾，看到历史里有很多意难平，看到小说的结局并不是自己喜欢的样子时，我们可能都会有一种冲动：想要改写这一切。

但真正有趣的不是只改掉一个结局，而是继续观察改写后的世界会如何发展。

如果项羽在鸿门宴杀了刘邦，后来的天下会怎样？

如果商鞅没有被车裂，秦国会走向哪里？

如果一本小说里的关键人物没有死，其他人又会如何重新选择？

AionCausa 就是为了这个冲动而做的：你给出一个假设，它尝试生成一个小世界，让你看到心中那个意难平的另一种可能。

## 当前版本能做什么

- 事件可行性预检：先判断输入的信息是否足够创建一个世界。
- 背景补全：结合用户输入和模型知识，补全必要背景、关键假设和争议点。
- 人物 Agent 生成：尽量生成具体人物，而不是抽象集团。
- 一幕一幕推进：每一幕代表一次局势相对收敛后的世界截面。
- 世界现场：用散点舞台展示人物，用行动卡展示事件推进。
- 人物详情：点击人物查看当前意图、意图变化和行动记录。
- 世界总结：用一段整体叙事总结目前已经发生的世界变化。
- 往期问答：在世界内部保留曾经问过人物的问题。
- 多模型接入：支持 OpenAI-compatible Chat Completions 和 Anthropic-compatible Messages 两类协议。

## 从零开始运行

### 1. 准备环境

你需要先安装：

- Node.js 22 或更高版本：[https://nodejs.org](https://nodejs.org)
- Git：用于克隆项目。如果不想安装 Git，也可以在 GitHub 页面下载 ZIP。
- 一个可用的 LLM API Key，例如 OpenAI、Gemini、Kimi、智谱、MiniMax、Claude，或任何兼容 OpenAI Chat Completions 的本地/云端网关。

安装完成后，在终端检查：

```bash
node -v
npm -v
```

如果能看到版本号，就说明 Node.js 和 npm 已经可用。

### 2. 获取项目

方式 A：使用 Git 克隆。

```bash
git clone https://github.com/waylean/AionCausa.git
cd AionCausa
```

方式 B：下载 ZIP。

1. 打开 GitHub 项目页面。
2. 点击 `Code`。
3. 点击 `Download ZIP`。
4. 解压 ZIP。
5. 在终端进入解压后的项目目录。

### 3. 安装依赖

在项目根目录运行：

```bash
npm install
```

这一步会安装前端、测试和构建所需依赖。第一次运行需要等待一段时间。

### 4. 启动开发服务

```bash
npm run dev
```

终端会输出一个本地地址，通常是：

```text
http://127.0.0.1:5173
```

用浏览器打开这个地址即可。如果 `5173` 端口被占用，Vite 会自动换一个端口，请以终端实际输出的地址为准。

### 5. 接入 AI 模型

AionCausa 必须接入可用的 LLM API 才能生成世界。项目不会内置任何 API Key，也不应该把真实 Key 提交到 GitHub。

打开网页后，进入 `模型配置` 页面，填写：

- Provider：选择预设服务，或选择自定义接口。
- Protocol：通常选择 `OpenAI-compatible` 或 `Anthropic-compatible`。
- Base URL：模型服务的 API 地址。
- Model：模型名称。
- API Key：你的模型服务密钥。
- Temperature：控制发散程度。
- Max Tokens：控制模型最大输出长度。

常见配置示例：

| 服务 | 推荐协议 | Base URL 示例 | Model 示例 |
| --- | --- | --- | --- |
| OpenAI / GPT | OpenAI-compatible | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Gemini OpenAI-compatible | OpenAI-compatible | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash` |
| Kimi / Moonshot | OpenAI-compatible | `https://api.moonshot.ai/v1` | `kimi-k2.6` |
| 智谱 GLM | OpenAI-compatible | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |
| MiniMax | OpenAI-compatible | `https://api.minimax.io/v1` | `MiniMax-M2.5` |
| Anthropic / Claude | Anthropic-compatible | `https://api.anthropic.com/v1` | `claude-3-5-sonnet-latest` |
| 本地兼容网关 | OpenAI-compatible | `http://localhost:11434/v1` | `llama3.1` |

也可以用环境变量做最小连通性测试：

```powershell
$env:AIONCAUSA_PROTOCOL="openai-compatible"
$env:AIONCAUSA_BASE_URL="https://api.openai.com/v1"
$env:AIONCAUSA_MODEL="gpt-4o-mini"
$env:AIONCAUSA_API_KEY="<your-api-key>"
npm run test:provider
```

`test:provider` 通过只代表模型连通性正常，不代表每一个复杂世界都一定能稳定生成。正式使用时仍建议在网页里完成 `分析可创建性 -> 生成沙盘 -> 推进下一幕` 的流程。

### 6. 创建第一个世界

1. 回到创建世界页面。
2. 在输入框写入中心事件，例如：

```text
如果商鞅变法成功后没有被车裂，秦国会如何发展？
```

3. 点击 `分析可创建性`。
4. 等待模型判断这个事件是否足够创建世界。
5. 如果预检通过，再点击 `生成沙盘`。
6. 生成完成后进入世界现场。
7. 点击 `推进下一幕`，让世界继续发展。
8. 点击人物点，查看这个人物的当前意图和行动记录。
9. 点击 `总结世界`，查看目前所有幕形成的整体故事。

注意：建议先做 `分析可创建性`，再生成沙盘。如果事件太模糊，系统会拒绝创建世界，避免生成空泛内容。

### 7. 检查、测试与构建

代码检查：

```bash
npm run lint
```

运行测试：

```bash
npm run test
```

构建生产版本：

```bash
npm run build
```

构建完成后，产物会输出到 `dist/`。如果需要本地预览生产版本：

```bash
npm run preview
```

## 页面按钮说明

### 创建世界页面

- `分析可创建性`：先把中心事件交给模型判断，确认是否有足够信息创建世界。这一步应该优先点击。
- `生成沙盘`：预检通过后创建事件世界。如果信息不足，系统会说明无法创建的原因。
- `最近世界`：打开之前生成过的本地世界。
- `删除世界`：删除某个本地归档世界。
- `刷新`：重新读取最近世界列表。
- `模型配置`：进入模型配置页面，填写或修改 API 服务信息。

### 世界现场页面

- `推进下一幕`：让世界继续运行一幕。每一幕不是固定回合，而是一次局势相对收敛后的截面。
- `总结世界`：重新总结目前所有幕已经发生的事情，形成一段整体叙事。
- `往期问答`：查看在当前世界中曾经问过人物的问题。
- `人物点`：点击散点舞台上的人物，查看人物详情、当前意图和行动记录。
- `行动卡`：按时间顺序查看本幕发生的行动。
- `返回创建`：回到创建世界页面，输入新的事件假设。

## 推荐输入方式

好的输入应该包含明确的改变点：

```text
如果商鞅变法成功后没有被车裂，秦国会如何发展？
```

```text
如果项羽在鸿门宴强杀刘邦，后续会怎么发展？
```

```text
如果林黛玉来到了哈利波特的世界，并遇见伏地魔，会发生什么？
```

不推荐过于模糊的输入：

```text
如果张三没有离开，会怎么样？
```

如果人物、世界、前提都无法判断，系统会拒绝创建世界，或提示用户补充信息。

## 项目结构

```text
src/App.tsx                    主界面、页面切换和交互状态
src/domain/worldRuntime.ts      世界运行时、幕推进、人物行动归并
src/domain/types.ts             事件世界核心类型
src/services/providers.ts       模型 provider 预设和请求构造
src/services/runtime.ts         世界推进服务
src/services/summary.ts         世界总结服务
src/services/interview.ts       人物采访服务
src/services/archives.ts        本地世界归档读写
vite.config.ts                  Vite 配置和本地 API middleware
docs/EXAMPLE.md                 示例事件和使用流程
```

## License

本项目使用 [MIT License](./LICENSE)。
