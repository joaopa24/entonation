import { useState, useRef } from "react";
import { Mic, Square, RotateCcw } from "lucide-react";

export default function App() {
  const [status, setStatus] = useState("");
  const [transcript, setTranscript] = useState("");
  const [confidence, setConfidence] = useState(null);
  const [intonationScore, setIntonationScore] = useState(null);
  const [intonationFeedback, setIntonationFeedback] = useState("");
  const [intonationDetails, setIntonationDetails] = useState(null);
  const [isRecording, setIsRecording] = useState(false);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  const startRecording = async () => {
    setStatus("🎤 Gravando...");
    setTranscript("");
    setConfidence(null);
    setIntonationScore(null);
    setIntonationFeedback("");
    setIntonationDetails(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      chunksRef.current = [];
      setIsRecording(true);

      mediaRecorderRef.current.ondataavailable = (event) => {
        chunksRef.current.push(event.data);
      };

      mediaRecorderRef.current.onstop = async () => {
        setStatus("⏳ Enviando para análise...");

        const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" });
        const formData = new FormData();
        formData.append("audio", audioBlob, "audio.webm");

        try {
          const response = await fetch("http://localhost:3000/analisar", {
            method: "POST",
            body: formData,
          });

          const text = await response.text();
          let data;

          try {
            data = JSON.parse(text);
          } catch {
            setStatus("❌ Erro: resposta inválida do servidor");
            return;
          }

          if (!response.ok) {
            setStatus("❌ Erro: " + data.error);
            return;
          }

          // ✔ Dados recebidos do backend
          setTranscript(data.analysis || "");
          setConfidence(data.confidence || 0);
          
          if (data.entonacao) {
            setIntonationScore(data.entonacao.score);
            setIntonationFeedback(data.entonacao.feedback);
            setIntonationDetails({
              range: data.entonacao.range?.toFixed(2),
              sd: data.entonacao.sd?.toFixed(2),
              slope: data.entonacao.slope?.toFixed(3)
            });
          }

          setStatus("✅ Análise concluída!");
        } catch (err) {
          setStatus("❌ Erro ao conectar ao servidor: " + err.message);
        }
      };

      mediaRecorderRef.current.start();
    } catch (err) {
      setStatus("❌ Permissão de microfone negada.");
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      setStatus("🔍 Processando...");
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const reset = () => {
    setStatus("");
    setTranscript("");
    setConfidence(null);
    setIntonationScore(null);
    setIntonationFeedback("");
    setIntonationDetails(null);
    setIsRecording(false);
  };

  const getScoreColor = (score) => {
    if (score >= 75) return "#10b981"; // verde
    if (score >= 50) return "#f59e0b"; // amarelo
    return "#ef4444"; // vermelho
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)", padding: "40px 20px" }}>
      <div style={{ maxWidth: "700px", margin: "0 auto" }}>
        <div style={{ background: "white", borderRadius: "20px", padding: "40px", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
          <h1 style={{ fontSize: "28px", marginBottom: "10px", color: "#333", textAlign: "center" }}>🎵 Analisador de Entonação</h1>
          <p style={{ color: "#666", textAlign: "center", marginBottom: "30px" }}>Grave seu áudio e deixe a IA analisar</p>

          <div style={{ display: "flex", gap: "12px", marginBottom: "30px", justifyContent: "center", flexWrap: "wrap" }}>
            <button
              onClick={startRecording}
              disabled={isRecording}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "12px 24px",
                fontSize: "16px",
                fontWeight: "600",
                border: "none",
                borderRadius: "12px",
                background: isRecording ? "#ccc" : "#667eea",
                color: "white",
                cursor: isRecording ? "not-allowed" : "pointer",
                transition: "all 0.3s",
              }}
            >
              <Mic size={20} /> Gravar
            </button>

            <button
              onClick={stopRecording}
              disabled={!isRecording}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "12px 24px",
                fontSize: "16px",
                fontWeight: "600",
                border: "none",
                borderRadius: "12px",
                background: !isRecording ? "#ccc" : "#ef4444",
                color: "white",
                cursor: !isRecording ? "not-allowed" : "pointer",
                transition: "all 0.3s",
              }}
            >
              <Square size={20} /> Parar
            </button>

            <button
              onClick={reset}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "12px 24px",
                fontSize: "16px",
                fontWeight: "600",
                border: "none",
                borderRadius: "12px",
                background: "#6b7280",
                color: "white",
                cursor: "pointer",
                transition: "all 0.3s",
              }}
            >
              <RotateCcw size={20} /> Limpar
            </button>
          </div>

          <div style={{
            background: "#f3f4f6",
            padding: "20px",
            borderRadius: "12px",
            marginBottom: "20px",
            minHeight: "60px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "16px",
            fontWeight: "500",
            color: "#333"
          }}>
            {status || "Clique em 'Gravar' para começar"}
          </div>

          {transcript && (
            <div style={{ marginTop: "30px" }}>
              {/* TRANSCRIÇÃO */}
              <div style={{
                background: "#e0f2fe",
                border: "2px solid #0284c7",
                padding: "20px",
                borderRadius: "12px",
                marginBottom: "20px"
              }}>
                <h3 style={{ color: "#0c4a6e", marginTop: 0, marginBottom: "10px" }}>📝 Transcrição:</h3>
                <p style={{ color: "#0c4a6e", lineHeight: "1.6", marginBottom: "10px" }}>{transcript}</p>
                <p style={{ color: "#075985", fontSize: "14px", margin: 0 }}>Confiança: {confidence.toFixed(1)}%</p>
              </div>

              {/* ENTONAÇÃO */}
              {intonationScore !== null && (
                <div style={{
                  background: "#fef3c7",
                  border: "2px solid #f59e0b",
                  padding: "20px",
                  borderRadius: "12px"
                }}>
                  <h3 style={{ color: "#92400e", marginTop: 0, marginBottom: "15px" }}>🎯 Análise de Entonação:</h3>
                  
                  <div style={{
                    background: "white",
                    padding: "15px",
                    borderRadius: "10px",
                    marginBottom: "15px",
                    textAlign: "center"
                  }}>
                    <p style={{ color: "#666", fontSize: "14px", margin: "0 0 8px 0" }}>Pontuação</p>
                    <p style={{
                      fontSize: "36px",
                      fontWeight: "700",
                      color: getScoreColor(intonationScore),
                      margin: 0
                    }}>
                      {intonationScore.toFixed(1)}/100
                    </p>
                  </div>

                  <div style={{
                    background: "white",
                    padding: "15px",
                    borderRadius: "10px",
                    marginBottom: "15px",
                    borderLeft: `4px solid ${getScoreColor(intonationScore)}`
                  }}>
                    <p style={{ color: "#375a7f", lineHeight: "1.6", margin: 0 }}>
                      {intonationFeedback}
                    </p>
                  </div>

                  {intonationDetails && (
                    <div style={{
                      background: "white",
                      padding: "15px",
                      borderRadius: "10px",
                      fontSize: "14px",
                      color: "#666"
                    }}>
                      <p style={{ margin: "6px 0" }}><strong>Variação tonal:</strong> {intonationDetails.range} Hz</p>
                      <p style={{ margin: "6px 0" }}><strong>Desvio padrão:</strong> {intonationDetails.sd}</p>
                      <p style={{ margin: "6px 0" }}><strong>Declinação:</strong> {intonationDetails.slope}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}