// VSL da desqualificada — portada do novaav /vsl.
// O vídeo (21MB) continua servido pelo deploy do novaav pra não inflar este repo.
import { useState, useRef, useEffect } from "react";
import { ChevronRight, Play, Pause, Volume2, VolumeX, Maximize } from "lucide-react";
import { initializeMetaPixel } from "@/lib/novaavPixel";

const CaptacaoVSL = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const [showButton, setShowButton] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [displayProgress, setDisplayProgress] = useState(0);
  const [maxWatchedProgress, setMaxWatchedProgress] = useState(0);

  const videoUrl = "https://novaav.brenoxavier.com.br/vsl.mp4";

  // Non-linear progress mapping: makes video appear MUCH shorter
  const calculateDisplayProgress = (actualProgress: number): number => {
    if (actualProgress <= 0.15) {
      return actualProgress * (0.8 / 0.15);
    } else {
      return 0.8 + ((actualProgress - 0.15) / 0.85) * 0.2;
    }
  };

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;

    const video = videoRef.current;
    const actualProgress = video.currentTime / video.duration;
    const displayProgressValue = calculateDisplayProgress(actualProgress);

    setDisplayProgress(displayProgressValue);

    if (actualProgress > maxWatchedProgress) {
      setMaxWatchedProgress(actualProgress);
    }

    if (actualProgress >= 0.9 && !showButton) {
      setShowButton(true);
    }
  };

  const togglePlayPause = () => {
    if (!videoRef.current) return;

    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const toggleFullscreen = () => {
    if (!videoRef.current) return;
    if (videoRef.current.requestFullscreen) {
      videoRef.current.requestFullscreen();
    }
  };

  const handleProgressBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!videoRef.current || !progressBarRef.current) return;

    const rect = progressBarRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickedProgress = clickX / rect.width;

    // Only allow seeking backwards or to already watched positions
    if (clickedProgress <= maxWatchedProgress) {
      videoRef.current.currentTime = clickedProgress * videoRef.current.duration;
    }
  };

  // Auto-play handling with sound
  useEffect(() => {
    initializeMetaPixel();
    if (videoRef.current) {
      videoRef.current.muted = false;
      setIsMuted(false);

      videoRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch(() => {
        if (videoRef.current) {
          videoRef.current.muted = true;
          setIsMuted(true);
          videoRef.current.play().then(() => {
            setIsPlaying(true);
          }).catch(() => {
            setIsPlaying(false);
          });
        }
      });
    }
  }, []);

  return (
    <div className="novaav-theme min-h-screen bg-background text-foreground flex flex-col items-center justify-center px-4 py-16">
      <div className="max-w-3xl w-full space-y-10 text-center">
        <h1 className="text-3xl md:text-5xl font-black tracking-tighter uppercase">
          Você já está com o desafio garantido
        </h1>
        <p className="text-lg md:text-xl text-foreground font-bold bg-primary/50 border border-primary px-6 py-4 rounded-2xl inline-block">
          Mas vou te entregar um planejamento para transformar o seu corpo no médio e longo prazo
        </p>

        {/* Video Player with Custom Controls */}
        <div className="w-full bg-secondary/20 border border-border rounded-3xl overflow-hidden shadow-2xl">
          <div className="relative">
            <video
              ref={videoRef}
              src={videoUrl}
              className="w-full aspect-video bg-black"
              onTimeUpdate={handleTimeUpdate}
              playsInline
              autoPlay
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              controlsList="nodownload nofullscreen noremoteplayback"
              disablePictureInPicture
            />

            {/* Custom Controls Overlay */}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
              {/* Progress Bar */}
              <div
                ref={progressBarRef}
                className="w-full h-2 bg-white/20 rounded-full cursor-pointer mb-3 overflow-hidden"
                onClick={handleProgressBarClick}
              >
                <div
                  className="h-full bg-primary transition-all duration-100"
                  style={{ width: `${displayProgress * 100}%` }}
                />
              </div>

              {/* Control Buttons */}
              <div className="flex items-center justify-between text-white">
                <div className="flex items-center gap-3">
                  <button
                    onClick={togglePlayPause}
                    className="hover:scale-110 transition-transform"
                    aria-label={isPlaying ? "Pause" : "Play"}
                  >
                    {isPlaying ? (
                      <Pause className="w-6 h-6" fill="white" />
                    ) : (
                      <Play className="w-6 h-6" fill="white" />
                    )}
                  </button>

                  <button
                    onClick={toggleMute}
                    className="hover:scale-110 transition-transform"
                    aria-label={isMuted ? "Unmute" : "Mute"}
                  >
                    {isMuted ? (
                      <VolumeX className="w-6 h-6" />
                    ) : (
                      <Volume2 className="w-6 h-6" />
                    )}
                  </button>
                </div>

                <button
                  onClick={toggleFullscreen}
                  className="hover:scale-110 transition-transform"
                  aria-label="Fullscreen"
                >
                  <Maximize className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Delayed Call to Action Button */}
        <div className={`transition-all duration-1000 transform ${showButton ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10 pointer-events-none'}`}>
          <a
            href="https://checkout.pagtrust.com.br/ckf42ea4cb?funnel=fn5dec80c4&ra=false"
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center justify-center w-full max-w-xl bg-primary hover:bg-primary/85 text-primary-foreground font-black text-xl md:text-2xl py-7 md:py-8 rounded-3xl transition-all transform hover:scale-[1.02] glow-green uppercase cursor-pointer"
          >
            <span className="flex items-center gap-3">
              QUERO A MINHA CONDIÇÃO ESPECIAL
              <ChevronRight className="group-hover:translate-x-1 transition-transform" />
            </span>
          </a>
          <p className="mt-4 text-sm text-muted-foreground">
            Oferta disponível por tempo limitado
          </p>
          <p className="mt-6 text-base md:text-lg text-accent font-semibold text-center max-w-xl mx-auto leading-relaxed">
            O cupom de R$300 já está incluído no link — não precisa escrever o código, o valor já vai estar atualizado.
          </p>
        </div>

        {/* WhatsApp Support Button */}
        <div className="mt-8 text-center">
          <a
            href="https://wa.me/5531970000101"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-3 bg-[#25D366] hover:bg-[#20BA5A] text-white font-bold text-base md:text-lg px-8 py-4 rounded-2xl transition-all transform hover:scale-105 shadow-lg"
          >
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
            </svg>
            <span>Dúvida sobre o desafio?</span>
          </a>
          <p className="mt-3 text-sm text-muted-foreground">
            Entre em contato com nosso suporte humano
          </p>
          <p className="text-xs text-muted-foreground">
            Atendimento de segunda a sexta no horário comercial
          </p>
          <p className="mt-2 text-sm text-muted-foreground font-semibold">
            📱 31 97000-0101
          </p>
        </div>
      </div>
    </div>
  );
};

export default CaptacaoVSL;
