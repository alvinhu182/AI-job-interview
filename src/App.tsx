import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Users, 
  Languages, 
  Mic, 
  MessageSquare, 
  Send, 
  ChevronRight, 
  RotateCcw, 
  Award,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Briefcase,
  Key,
  ExternalLink,
  Info,
  Share2,
  Copy
} from 'lucide-react';
import { SetupData, Message, EvaluationReport, Modality } from './types';
import { getNextQuestion, generateEvaluation } from './lib/gemini';

export default function App() {
  const [step, setStep] = useState<'apiKey' | 'setup' | 'interview' | 'report'>('apiKey');
  const [apiKey, setApiKey] = useState('');
  const [setupData, setSetupData] = useState<SetupData>({
    area: '',
    language: 'Português',
    modality: 'Texto',
  });
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [report, setReport] = useState<EvaluationReport | null>(null);
  const [questionCount, setQuestionCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const recognitionRef = useRef<any>(null);
  const synthesisRef = useRef<SpeechSynthesis | null>(null);

  useEffect(() => {
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) {
      setApiKey(savedKey);
      setStep('setup');
    }
  }, []);

  const saveApiKey = (key: string) => {
    if (!key.trim()) return;
    localStorage.setItem('gemini_api_key', key.trim());
    setApiKey(key.trim());
    setStep('setup');
  };

  useEffect(() => {
    synthesisRef.current = window.speechSynthesis;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;

      recognitionRef.current.onresult = (event: any) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          }
        }
        if (finalTranscript) {
          setVoiceTranscript(prev => `${prev} ${finalTranscript}`.trim());
        }
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsRecording(false);
      };

      recognitionRef.current.onend = () => {
        // Only stop if we specifically asked to
      };
    }
  }, []);

  const speak = (text: string) => {
    if (!synthesisRef.current) return;
    
    // Stop any current speech
    synthesisRef.current.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = setupData.language === 'English' ? 'en-US' : setupData.language === 'Español' ? 'es-ES' : 'pt-BR';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    
    synthesisRef.current.speak(utterance);
  };

  useEffect(() => {
    if (recognitionRef.current) {
      recognitionRef.current.lang = setupData.language === 'English' ? 'en-US' : setupData.language === 'Español' ? 'es-ES' : 'pt-BR';
    }
  }, [setupData.language]);

  const toggleRecording = () => {
    if (!recognitionRef.current) {
      alert('Seu navegador não suporta reconhecimento de voz.');
      return;
    }

    if (isRecording) {
      recognitionRef.current.stop();
      setIsRecording(false);
    } else {
      if (isSpeaking) synthesisRef.current?.cancel();
      setVoiceTranscript('');
      setIsRecording(true);
      recognitionRef.current.start();
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const startInterview = async () => {
    if (!setupData.area) return;
    setStep('interview');
    setIsLoading(true);
    try {
      const firstQuestion = await getNextQuestion(setupData, [], apiKey);
      setMessages([
        {
          id: Date.now().toString(),
          role: 'interviewer',
          content: firstQuestion,
          timestamp: Date.now(),
        },
      ]);
      setQuestionCount(1);
      if (setupData.modality === 'Voz') {
        speak(firstQuestion);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendMessage = async (explicitContent?: string) => {
    const content = explicitContent || (setupData.modality === 'Voz' ? voiceTranscript : inputValue);
    if (!content.trim() || isLoading) return;

    if (setupData.modality === 'Voz' && isRecording) {
      recognitionRef.current.stop();
      setIsRecording(false);
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'candidate',
      content: content,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setVoiceTranscript('');
    setIsLoading(true);

    try {
      if (content.toLowerCase().includes('encerrar') || questionCount >= 8) {
        handleEndInterview([...messages, userMessage]);
        return;
      }

      const nextQ = await getNextQuestion(setupData, [...messages, userMessage], apiKey);
      setMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'interviewer',
          content: nextQ,
          timestamp: Date.now(),
        },
      ]);
      setQuestionCount(prev => prev + 1);
      if (setupData.modality === 'Voz') {
        speak(nextQ);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEndInterview = async (finalMessages: Message[]) => {
    setStep('report');
    setIsLoading(true);
    try {
      const evalReport = await generateEvaluation(setupData, finalMessages, apiKey);
      setReport(evalReport);
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const reset = () => {
    setStep('setup');
    setMessages([]);
    setReport(null);
    setQuestionCount(0);
    setSetupData({
      area: '',
      language: 'Português',
      modality: 'Texto',
    });
  };

  const shareResults = async () => {
    if (!report) return;

    const shareContent = `
🎓 IA Intervee - Resultado da Entrevista
Área: ${setupData.area}
Score Final: ${report.nota_final}/10

✅ Pontos Fortes:
${report.pros.map(p => `- ${p}`).join('\n')}

💡 Dicas de Melhoria:
${report.contras.map(c => `- ${c}`).join('\n')}

Simulado com a IA Intervee. Pratique você também!
    `.trim();

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Meu Resultado na IA Intervee',
          text: shareContent,
          url: window.location.href,
        });
      } catch (err) {
        console.error('Error sharing:', err);
      }
    } else {
      try {
        await navigator.clipboard.writeText(shareContent);
        alert('Resultado copiado para a área de transferência!');
      } catch (err) {
        console.error('Error copying:', err);
      }
    }
  };

  return (
    <div className="min-h-screen bg-bg-main text-slate-300 font-sans flex flex-col">
      {/* Header Navigation */}
      <nav className="h-16 border-b border-white/10 flex items-center justify-between px-8 bg-bg-accent/80 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Users className="w-5 h-5 text-white" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-white">
            Recrutador IA <span className="text-indigo-400">Senior</span>
          </span>
        </div>
        <div className="flex items-center gap-6">
          <div className="hidden md:flex items-center gap-2 text-[10px] uppercase tracking-widest text-slate-500 font-bold">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
            Sessão Ativa
          </div>
          {apiKey && (
            <button
              onClick={() => {
                localStorage.removeItem('gemini_api_key');
                setApiKey('');
                setStep('apiKey');
              }}
              className="p-2 text-slate-500 hover:text-white transition-colors"
              title="Mudar API Key"
            >
              <Key size={18} />
            </button>
          )}
          {(step === 'interview' || step === 'report') && (
            <button 
              onClick={reset}
              className="px-4 py-1.5 border border-red-900/50 text-red-400 text-[10px] font-bold rounded-full hover:bg-red-900/20 transition-all uppercase tracking-widest"
            >
              Encerrar
            </button>
          )}
        </div>
      </nav>

      <main className="flex-1 flex overflow-hidden max-w-[1400px] mx-auto w-full">
        {step === 'interview' && (
          <aside className="hidden lg:flex w-72 border-r border-white/5 bg-bg-card p-6 flex-col gap-8 flex-shrink-0">
            <div>
              <h3 className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold mb-4">Configuração</h3>
              <div className="space-y-3">
                <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                  <p className="text-[10px] text-indigo-400 uppercase font-bold mb-1">Área de Atuação</p>
                  <p className="text-sm text-white font-medium truncate">{setupData.area}</p>
                </div>
                <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                  <p className="text-[10px] text-indigo-400 uppercase font-bold mb-1">Idioma</p>
                  <p className="text-sm text-white font-medium">{setupData.language}</p>
                </div>
                <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                  <p className="text-[10px] text-indigo-400 uppercase font-bold mb-1">Modalidade</p>
                  <p className="text-sm text-white font-medium">{setupData.modality}</p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold mb-4">Progresso</h3>
              <div className="relative h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${(questionCount / 8) * 100}%` }}
                  className="absolute left-0 top-0 h-full bg-indigo-500 rounded-full"
                />
              </div>
              <p className="mt-3 text-xs text-slate-400 font-medium">Pergunta <span className="text-white">{questionCount}</span> de 8</p>
            </div>

            <div className="mt-auto p-4 bg-indigo-600/10 border border-indigo-500/20 rounded-2xl">
              <p className="text-xs text-indigo-300 leading-relaxed italic">
                "Mantenha as respostas objetivas e foque em resultados práticos."
              </p>
            </div>
          </aside>
        )}

        <section className="flex-1 flex flex-col min-w-0 bg-gradient-to-br from-bg-main to-bg-accent overflow-hidden">
        <AnimatePresence mode="wait">
          {step === 'apiKey' && (
            <motion.div
              key="api-key"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex-1 flex items-center justify-center p-8"
            >
              <div className="w-full max-w-xl bg-bg-card rounded-3xl p-10 border border-white/10 shadow-2xl space-y-8">
                <div className="text-center space-y-3">
                  <div className="w-16 h-16 bg-indigo-600/20 rounded-2xl flex items-center justify-center mx-auto text-indigo-400">
                    <Key size={32} />
                  </div>
                  <h2 className="text-2xl font-bold text-white">Gemini API Key</h2>
                  <p className="text-slate-400 text-sm">Para tornar esta plataforma gratuita e acessível, você precisa fornecer sua própria chave da API Gemini.</p>
                </div>

                <div className="space-y-4">
                  <div className="bg-indigo-600/5 border border-indigo-500/10 p-5 rounded-2xl space-y-4">
                    <h3 className="flex items-center gap-2 text-[10px] font-bold text-indigo-400 uppercase tracking-widest">
                      <Info size={14} /> Como obter sua chave
                    </h3>
                    <ol className="text-xs text-slate-300 space-y-3 list-decimal pl-4 leading-relaxed font-medium">
                      <li>Acesse o <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline inline-flex items-center gap-1">Google AI Studio <ExternalLink size={10} /></a>.</li>
                      <li>Faça login com sua conta Google.</li>
                      <li>Clique em <span className="text-white font-bold">"Create API key"</span>.</li>
                      <li>Copie a chave gerada e cole no campo abaixo.</li>
                    </ol>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold px-1">Sua Chave API</label>
                    <input
                      type="password"
                      placeholder="AIzaSy..."
                      className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-white focus:outline-none focus:border-indigo-500 transition-all font-mono text-sm"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && saveApiKey(apiKey)}
                    />
                  </div>

                  <button
                    onClick={() => saveApiKey(apiKey)}
                    disabled={!apiKey.trim()}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-5 rounded-2xl font-bold text-sm uppercase tracking-widest shadow-xl shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                  >
                    Salvar e Continuar
                  </button>
                  
                  <p className="text-[10px] text-center text-slate-500">Sua chave é armazenada apenas localmente no seu navegador.</p>
                </div>
              </div>
            </motion.div>
          )}

          {step === 'setup' && (
              <motion.div
                key="setup"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.02 }}
                className="flex-1 flex items-center justify-center p-8"
              >
                <div className="w-full max-w-xl bg-bg-card rounded-3xl p-10 border border-white/10 shadow-2xl">
                  <div className="space-y-10">
                    <div className="text-center">
                      <h2 className="text-2xl font-bold text-white mb-2">Simulador de Entrevista</h2>
                      <p className="text-slate-400 text-sm">Prepare-se para o mercado com feedback de IA especializada.</p>
                    </div>

                    <div className="space-y-6">
                      <section>
                        <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-indigo-400 font-bold mb-3">
                          <Users size={14} /> Área de Atuação
                        </label>
                        <input
                          type="text"
                          placeholder="Engenheiro de Software Senior..."
                          className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-all font-medium"
                          value={setupData.area}
                          onChange={(e) => setSetupData({ ...setupData, area: e.target.value })}
                        />
                      </section>

                      <section>
                        <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-indigo-400 font-bold mb-3">
                          <Briefcase size={14} /> Resumo Profissional (Opcional)
                        </label>
                        <textarea
                          placeholder="Cole seu resumo profissional ou descreva suas experiências principais..."
                          className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-all font-medium h-24 resize-none"
                          value={setupData.professionalSummary || ''}
                          onChange={(e) => setSetupData({ ...setupData, professionalSummary: e.target.value })}
                        />
                      </section>

                      <div className="grid grid-cols-2 gap-6">
                        <section>
                          <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-indigo-400 font-bold mb-3">
                            <Languages size={14} /> Idioma
                          </label>
                          <select
                            className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-all cursor-pointer appearance-none"
                            value={setupData.language}
                            onChange={(e) => setSetupData({ ...setupData, language: e.target.value })}
                          >
                            <option className="bg-bg-card">Português</option>
                            <option className="bg-bg-card">English</option>
                            <option className="bg-bg-card">Español</option>
                          </select>
                        </section>

                        <section>
                          <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-indigo-400 font-bold mb-3">
                            <Mic size={14} /> Modalidade
                          </label>
                          <div className="flex gap-2">
                            {(['Texto', 'Voz'] as Modality[]).map((m) => (
                              <button
                                key={m}
                                onClick={() => setSetupData({ ...setupData, modality: m })}
                                className={`flex-1 py-4 px-2 rounded-xl text-xs font-bold transition-all border ${
                                  setupData.modality === m
                                    ? 'bg-indigo-600 text-white border-indigo-500 shadow-lg shadow-indigo-500/20'
                                    : 'bg-white/5 text-slate-400 border-white/5 hover:border-white/10'
                                }`}
                              >
                                {m}
                              </button>
                            ))}
                          </div>
                        </section>
                      </div>
                    </div>

                    <button
                      onClick={startInterview}
                      disabled={!setupData.area}
                      className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-5 rounded-2xl font-bold text-sm uppercase tracking-widest shadow-xl shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-3 group"
                    >
                      Iniciar Preparação
                      <ChevronRight size={18} className="group-hover:translate-x-1 transition-transform" />
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {step === 'interview' && (
              <motion.div
                key="interview"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 flex flex-col p-6 md:p-10 h-full relative"
              >
                {setupData.modality === 'Texto' ? (
                  <>
                    <div className="flex-1 overflow-y-auto space-y-8 scrollbar-hide pb-32 px-2">
                      {messages.map((message) => (
                        <motion.div
                          key={message.id}
                          initial={{ opacity: 0, x: message.role === 'candidate' ? 20 : -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          className={`flex items-start gap-4 ${message.role === 'candidate' ? 'flex-row-reverse' : ''}`}
                        >
                          <div className={`w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold shadow-lg ${
                            message.role === 'candidate' 
                              ? 'bg-slate-700 text-white' 
                              : 'bg-gradient-to-tr from-indigo-600 to-violet-600 text-white shadow-indigo-500/20'
                          }`}>
                            {message.role === 'candidate' ? 'EU' : 'IA'}
                          </div>
                          <div className={`space-y-1 ${message.role === 'candidate' ? 'text-right' : ''}`}>
                            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                              {message.role === 'candidate' ? 'Candidato' : 'Recrutador Sênior'}
                            </span>
                            <div className={`p-5 rounded-2xl max-w-2xl text-base leading-relaxed ${
                              message.role === 'candidate'
                                ? 'bg-indigo-600 text-white rounded-tr-none'
                                : 'bg-white/5 border border-white/5 text-white rounded-tl-none'
                            }`}>
                              {message.content}
                            </div>
                          </div>
                        </motion.div>
                      ))}
                      {isLoading && (
                        <div className="flex items-start gap-4">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-indigo-600 to-violet-600 flex-shrink-0 flex items-center justify-center text-xs font-bold text-white shadow-lg shadow-indigo-500/20">
                            IA
                          </div>
                          <div className="bg-white/5 border border-white/5 p-5 rounded-2xl rounded-tl-none flex gap-1.5">
                            <motion.span animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1, delay: 0 }} className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                            <motion.span animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                            <motion.span animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                          </div>
                        </div>
                      )}
                      <div ref={messagesEndRef} />
                    </div>

                    <div className="absolute bottom-10 left-6 right-6 md:left-10 md:right-10">
                      <div className="relative group">
                        <textarea
                          placeholder="Digite sua resposta detalhada..."
                          className="w-full bg-bg-accent/90 backdrop-blur-xl border border-white/10 rounded-3xl p-6 pr-40 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-all h-28 resize-none shadow-2xl"
                          value={inputValue}
                          onChange={(e) => setInputValue(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSendMessage())}
                        />
                        <div className="absolute right-4 bottom-4 flex gap-3">
                          <button
                            onClick={() => handleSendMessage()}
                            disabled={!inputValue.trim() || isLoading}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-3 rounded-2xl font-bold text-xs uppercase tracking-widest shadow-lg shadow-indigo-500/20 disabled:opacity-50 transition-all"
                          >
                            Enviar
                          </button>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center space-y-12">
                    <div className="relative">
                      <AnimatePresence>
                        {(isSpeaking || isLoading || isRecording) && (
                          <motion.div
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1.2, opacity: 0.2 }}
                            exit={{ scale: 0.8, opacity: 0 }}
                            transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
                            className={`absolute -inset-8 rounded-full blur-2xl ${
                              isRecording ? 'bg-red-500' : 'bg-indigo-500'
                            }`}
                          />
                        )}
                      </AnimatePresence>
                      
                      <button
                        onClick={toggleRecording}
                        disabled={isLoading || isSpeaking}
                        className={`relative w-32 h-32 rounded-full flex items-center justify-center transition-all shadow-2xl ${
                          isRecording 
                            ? 'bg-red-600 shadow-red-500/40 scale-110' 
                            : 'bg-white/10 hover:bg-white/20 border border-white/10'
                        } disabled:opacity-50`}
                      >
                        {isRecording ? (
                          <Mic className="text-white animate-pulse" size={48} />
                        ) : isSpeaking ? (
                          <Loader2 className="text-indigo-400 animate-spin" size={48} />
                        ) : (
                          <Mic className="text-white" size={48} />
                        )}
                      </button>
                    </div>

                    <div className="text-center space-y-4 max-w-md">
                      <h3 className="text-2xl font-bold text-white uppercase tracking-widest">
                        {isRecording ? 'Ouvindo você...' : isSpeaking ? 'Recrutador Falando...' : isLoading ? 'IA Processando...' : 'Toque para responder'}
                      </h3>
                      {voiceTranscript && (
                        <div className="bg-white/5 border border-white/10 p-4 rounded-2xl max-h-32 overflow-y-auto w-full mb-4">
                          <p className="text-xs text-white/70 italic leading-relaxed">
                            "{voiceTranscript}"
                          </p>
                        </div>
                      )}
                      <p className="text-slate-400 font-medium">
                        {isRecording ? 'Fale naturalmente. Toque no botão abaixo quando terminar.' : isSpeaking ? 'Ouça com atenção a pergunta.' : 'A interação por voz é contínua.'}
                      </p>
                    </div>

                    <div className="flex flex-col items-center gap-6">
                      {isRecording && (
                        <button
                          onClick={() => handleSendMessage()}
                          className="px-10 py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-bold text-xs uppercase tracking-widest transition-all shadow-xl shadow-indigo-500/20"
                        >
                          Enviar Resposta
                        </button>
                      )}
                      
                      {isSpeaking && (
                        <div className="flex items-end gap-1 h-8">
                          {[...Array(5)].map((_, i) => (
                            <motion.div
                              key={i}
                              animate={{ height: [10, 32, 10] }}
                              transition={{ repeat: Infinity, duration: 0.6, delay: i * 0.1 }}
                              className="w-1.5 bg-indigo-500 rounded-full"
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {step === 'report' && (
              <motion.div
                key="report"
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="flex-1 p-6 md:p-12 overflow-y-auto scrollbar-hide"
              >
                {isLoading ? (
                  <div className="h-full flex flex-col items-center justify-center space-y-6 py-20">
                    <div className="relative">
                      <div className="w-24 h-24 rounded-full border-4 border-indigo-500/20 border-t-indigo-500 animate-spin" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Award className="text-indigo-400" size={32} />
                      </div>
                    </div>
                    <div className="text-center space-y-2">
                      <h3 className="text-2xl font-bold text-white">Analisando Desempenho</h3>
                      <p className="text-slate-500 text-sm max-w-xs mx-auto">Nossas redes neurais estão gerando um feedback técnico personalizado para você.</p>
                    </div>
                  </div>
                ) : report && (
                  <div className="w-full max-w-4xl mx-auto space-y-8 pb-20">
                    {/* Hero Header */}
                    <header className="flex flex-col md:flex-row items-center justify-between gap-8 bg-indigo-600 rounded-[3rem] p-10 shadow-2xl shadow-indigo-500/10 relative overflow-hidden">
                      <div className="relative z-10 flex flex-col items-center md:items-start text-center md:text-left">
                        <span className="text-indigo-100/60 font-bold uppercase tracking-[0.3em] text-[10px] mb-2 leading-none">Resultado Final</span>
                        <h2 className="text-white text-3xl font-bold mb-4">Relatório de Performance</h2>
                        <div className="flex items-center gap-3 px-4 py-2 bg-white/10 rounded-full border border-white/10">
                          <CheckCircle2 size={16} className="text-indigo-200" />
                          <span className="text-white text-xs font-bold uppercase tracking-widest">{report.nota_final >= 7 ? 'Aprovado para Vaga' : 'Review Necessário'}</span>
                        </div>
                      </div>
                      <div className="relative z-10 flex flex-col items-center justify-center bg-white/10 backdrop-blur-md rounded-full w-40 h-40 border border-white/20">
                        <span className="text-5xl font-black text-white">{report.nota_final}</span>
                        <span className="text-[10px] uppercase tracking-widest text-indigo-200 font-bold leading-none mt-1">Score Global</span>
                      </div>
                      {/* Background Accents */}
                      <div className="absolute -right-10 -bottom-10 w-64 h-64 bg-indigo-400 rounded-full blur-[120px] opacity-20" />
                    </header>

                    {/* Language and General Card */}
                    <div className="grid md:grid-cols-3 gap-6">
                      <div className="md:col-span-1 bg-bg-card border border-white/5 rounded-3xl p-8 space-y-4">
                        <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center text-indigo-400">
                          <Languages size={24} />
                        </div>
                        <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Avaliação Linguística</h4>
                        <p className="text-white text-sm font-medium leading-relaxed">{report.idioma_dominio}</p>
                      </div>
                      <div className="md:col-span-2 bg-bg-card border border-white/5 rounded-3xl p-8 space-y-4">
                        <div className="w-12 h-12 rounded-2xl bg-violet-500/10 flex items-center justify-center text-violet-400">
                          <Award size={24} />
                        </div>
                        <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Feedback Geral</h4>
                        <p className="text-white text-lg font-medium leading-relaxed italic">"{report.feedback_geral}"</p>
                      </div>
                    </div>

                    {/* Details Grid */}
                    <div className="grid md:grid-cols-2 gap-8">
                      <section className="bg-emerald-500/5 border border-emerald-500/10 rounded-[2.5rem] p-10">
                        <h3 className="flex items-center gap-2 text-xs font-bold text-emerald-400 mb-8 uppercase tracking-widest">
                          <CheckCircle2 size={18} /> Pontos de Excelência
                        </h3>
                        <ul className="space-y-6">
                          {report.pros.map((pro, i) => (
                            <li key={i} className="flex gap-4 group">
                              <span className="flex-shrink-0 w-6 h-6 rounded-lg bg-emerald-500/10 flex items-center justify-center text-[10px] font-bold text-emerald-400">0{i+1}</span>
                              <span className="text-slate-300 text-sm leading-relaxed font-medium">{pro}</span>
                            </li>
                          ))}
                        </ul>
                      </section>

                      <section className="bg-amber-500/5 border border-amber-500/10 rounded-[2.5rem] p-10">
                        <h3 className="flex items-center gap-2 text-xs font-bold text-amber-400 mb-8 uppercase tracking-widest">
                          <AlertCircle size={18} /> Oportunidades de Crescimento
                        </h3>
                        <ul className="space-y-6">
                          {report.contras.map((contra, i) => (
                            <li key={i} className="flex gap-4 group">
                              <span className="flex-shrink-0 w-6 h-6 rounded-lg bg-amber-500/10 flex items-center justify-center text-[10px] font-bold text-amber-400">0{i+1}</span>
                              <span className="text-slate-300 text-sm leading-relaxed font-medium">{contra}</span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4 pt-8">
                      <button
                        onClick={shareResults}
                        className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-6 rounded-3xl font-bold text-sm uppercase tracking-[0.2em] transition-all shadow-xl shadow-indigo-500/20 flex items-center justify-center gap-4 group"
                      >
                        <Share2 size={20} className="group-hover:scale-110 transition-transform" />
                        Compartilhar Resultado
                      </button>
                      <button
                        onClick={reset}
                        className="flex-1 bg-white/5 hover:bg-white/10 text-white py-6 rounded-3xl font-bold text-sm uppercase tracking-[0.2em] transition-all border border-white/5 flex items-center justify-center gap-4 group"
                      >
                        <RotateCcw size={20} className="group-hover:rotate-[-180deg] transition-transform duration-500" />
                        Nova Simulação
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </main>
    </div>
  );
}
