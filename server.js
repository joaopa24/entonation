import express from "express";
import multer from "multer";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@deepgram/sdk";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import fs from "fs";
import path from "path";
import Pitchfinder from "pitchfinder";

dotenv.config();

ffmpeg.setFfmpegPath(ffmpegStatic);

const tempDir = "D:/temp-ffmpeg";
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

const saveBaseDir = "D:/audios-salvos";
if (!fs.existsSync(saveBaseDir)) fs.mkdirSync(saveBaseDir, { recursive: true });

const app = express();
const upload = multer();
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

app.use(cors({ origin: "http://localhost:5173" }));

// ======================================
// 📌 Função para converter Buffer → Float32
// ======================================
function bufferToFloat32(buffer) {
  const output = [];
  for (let i = 0; i < buffer.length; i += 2) {
    const sample = buffer.readInt16LE(i);
    output.push(sample / 32768);
  }
  return new Float32Array(output);
}

// ======================================
// 📌 Amplificar áudio para melhor detecção
// ======================================
function amplificarAudio(floatSamples, gain = 2.0) {
  return new Float32Array(floatSamples.map(s => {
    const amplified = s * gain;
    // Evitar clipping
    return Math.max(-1, Math.min(1, amplified));
  }));
}

// ======================================
// ⭐ Analisador de entonação melhorado
// ======================================
function analisarEntonacao(floatSamples) {
  // Amplificar se muito baixo
  let samples = floatSamples;
  const maxAmplitude = Math.max(...floatSamples.map(Math.abs));
  
  if (maxAmplitude < 0.1) {
    console.log("⚠️ Áudio muito baixo, amplificando...");
    samples = amplificarAudio(floatSamples, 3.0);
  }

  const detectPitch = Pitchfinder.YIN({ sampleRate: 16000 });
  const pitches = [];
  
  // Aumentar janela para melhor detecção (160 para 512)
  const windowSize = 512;
  const hop = 256;

  for (let i = 0; i < samples.length - windowSize; i += hop) {
    const slice = samples.slice(i, i + windowSize);
    const pitch = detectPitch(slice);
    
    // Ampliar faixa de detecção (50-500 Hz)
    if (pitch && pitch > 40 && pitch < 600) {
      pitches.push(pitch);
    }
  }

  console.log(`🎙️ Pitches detectados: ${pitches.length}`);

  // Se ainda assim tiver muito poucos, tentar com threshold menor
  if (pitches.length < 5) {
    console.log("⚠️ Poucos pitches encontrados, tentando novamente com threshold reduzido...");
    
    for (let i = 0; i < samples.length - windowSize; i += hop) {
      const slice = samples.slice(i, i + windowSize);
      const pitch = detectPitch(slice);
      if (pitch && pitch > 30 && pitch < 800) {
        pitches.push(pitch);
      }
    }
  }

  // Se ainda assim não conseguir, retornar score 0 com mais contexto
  if (pitches.length < 5) {
    return {
      score: 0,
      feedback: "⚠️ Não foi possível analisar a entonação. Verifique:\n• Fale mais alto\n• Grave por mais tempo (mínimo 3-5 segundos)\n• Verifique se o microfone está funcionando"
    };
  }

  // Calcular métricas
  const min = Math.min(...pitches);
  const max = Math.max(...pitches);
  const range = max - min;

  const mean = pitches.reduce((a, b) => a + b, 0) / pitches.length;
  const variance = pitches.reduce((a, b) => a + (b - mean) ** 2, 0) / pitches.length;
  const sd = Math.sqrt(variance);

  const slope = (pitches[pitches.length - 1] - pitches[0]) / pitches.length;

  let score = 0;

  // Range: variação entre notas mais altas e mais baixas
  if (range < 20) score += 10;         // muito pouca variação
  else if (range < 60) score += 30;    // variação ok
  else score += 40;                    // ótima variação

  // Variação saudável: desvio padrão
  if (sd < 10) score += 10;            // muito robótico
  else if (sd < 40) score += 30;       // ideal
  else score += 20;

  // Declinação: como a voz cai no fim
  if (slope < -0.1) score += 30;       // frase natural (cai)
  else if (slope < 0.05) score += 20;  // neutra
  else score += 10;                    // soa como pergunta (sobe)

  // Feedback textual
  let feedback = "";

  if (range < 20) feedback += "Sua entonação está muito reta (monótona). Tente variar mais a altura da voz. ";
  else if (range < 60) feedback += "Boa variação de entonação. ";
  else feedback += "✨ Ótima variação tonal! ";

  if (sd > 40) feedback += "Sua voz está tremida ou instável. ";
  else if (sd < 10) feedback += "Voz robótica demais. Tente ser mais expressivo. ";
  else feedback += "Ótima estabilidade na voz. ";
  
  if (slope > 0.1) feedback += "Você terminou a frase subindo (soa como pergunta). ";
  else if (slope < -0.1) feedback += "Você terminou a frase caindo (natural para afirmações).";
  else feedback += "Finalização neutra.";

  return {
    score: Math.min(100, Math.max(0, score)),
    feedback: feedback.trim(),
    range: parseFloat(range.toFixed(2)),
    sd: parseFloat(sd.toFixed(2)),
    slope: parseFloat(slope.toFixed(4)),
    pitchCount: pitches.length,
    meanPitch: parseFloat(mean.toFixed(2))
  };
}

// ======================================
// 📌 ENDPOINT PRINCIPAL
// ======================================
app.post("/analisar", upload.single("audio"), async (req, res) => {
  let tempInputPath = null;
  let tempOutputPath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: "Nenhum arquivo enviado" });
    }

    const today = new Date().toISOString().split("T")[0];
    const saveDir = path.join(saveBaseDir, today);
    if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });

    const timeTag = Date.now();

    const originalSavePath = path.join(saveDir, `original-${timeTag}.webm`);
    const processedSavePath = path.join(saveDir, `processado-${timeTag}.wav`);

    tempInputPath = path.join(tempDir, `input-${timeTag}.tmp`);
    tempOutputPath = path.join(tempDir, `output-${timeTag}.wav`);

    // Salvar original + temp
    fs.writeFileSync(tempInputPath, req.file.buffer);
    fs.writeFileSync(originalSavePath, req.file.buffer);

    // Processar com ffmpeg
    await new Promise((resolve, reject) => {
      ffmpeg(tempInputPath)
        .outputOptions("-y")
        .audioCodec("pcm_s16le")
        .audioFrequency(16000)
        .audioChannels(1)
        .format("wav")
        .save(tempOutputPath)
        .on("end", resolve)
        .on("error", reject);
    });

    const processedBuffer = fs.readFileSync(tempOutputPath);
    fs.writeFileSync(processedSavePath, processedBuffer);

    // ======================
    // 🎤 ANÁLISE DE ENTONAÇÃO
    // ======================
    const floatSamples = bufferToFloat32(processedBuffer);
    const entonacao = analisarEntonacao(floatSamples);

    // ======================
    // 🧠 Deepgram
    // ======================
    const dgRes = await deepgram.listen.prerecorded.transcribeFile(processedBuffer, {
      model: "nova-2",
      smartFormat: true,
      language: "en",
      punctuate: true,
    });

    const transcript =
      dgRes.result?.results?.channels?.[0]?.alternatives?.[0]?.transcript;

    const confidence =
      dgRes.result?.results?.channels?.[0]?.alternatives?.[0]?.confidence || 0;

    res.json({
      analysis: transcript || "",
      confidence: parseFloat((confidence * 100).toFixed(2)),
      entonacao,
      original: originalSavePath,
      processed: processedSavePath
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    if (tempInputPath && fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
    if (tempOutputPath && fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
  }
});

app.listen(3000, () => {
  console.log("Servidor rodando em http://localhost:3000");
});