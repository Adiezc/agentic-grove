/**
 * The speech models voice can use, kept free of Node so the page can show their sizes too. The
 * downloading and the listening are in `whisper.ts`.
 */

export type VoiceModelId = 'base.en' | 'small.en'

export interface VoiceModel {
  id: VoiceModelId
  label: string
  /** Exact size in bytes, as published. */
  bytes: number
  sha256: string
  url: string
}

/**
 * The two English models on offer. Base is quick and good for short instructions; small hears
 * better and takes about three times as long. Sizes and checksums are the ones Hugging Face
 * publishes for these files (read 18 October 2026).
 */
export const VOICE_MODELS: Record<VoiceModelId, VoiceModel> = {
  'base.en': {
    id: 'base.en',
    label: 'Base (English)',
    bytes: 147_964_211,
    sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
  },
  'small.en': {
    id: 'small.en',
    label: 'Small (English)',
    bytes: 487_614_201,
    sha256: 'c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
  },
}

