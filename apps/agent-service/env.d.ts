/// <reference types="node" />

namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: 'development' | 'production' | 'test'
    PORT?: string

    // LLM Provider
    LLM_PROVIDER?: 'glm' | 'claude' | 'openai' | 'openrouter' | 'kimi'

    // GLM Provider
    GLM_API_KEY?: string
    GLM_MODEL?: string

    // Claude Provider
    ANTHROPIC_API_KEY?: string
    CLAUDE_MODEL?: string

    // OpenAI Provider
    OPENAI_API_KEY?: string
    OPENAI_MODEL?: string

    // OpenRouter Provider
    OPENROUTER_API_KEY?: string
    OPENROUTER_MODEL?: string

    // Kimi (Moonshot AI) Provider
    KIMI_API_KEY?: string
    KIMI_MODEL?: string
    KIMI_BASE_URL?: string

    // Sandbox
    SANDBOX_PROVIDER?: 'native' | 'claude' | 'docker' | 'e2b'
    WORK_DIR?: string
    SANDBOX_TIMEOUT?: string

    // CORS
    FRONTEND_URL?: string
  }
}

export {}
