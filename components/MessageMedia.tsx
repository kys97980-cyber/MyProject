import { createAudioPlayer, type AudioPlayer, type AudioStatus } from "expo-audio";
import { VideoView, useVideoPlayer } from "expo-video";
import { useEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions, type GestureResponderEvent } from "react-native";
import { useAuthenticatedMediaSource } from "@/components/AuthenticatedImage";

export type StoredMedia = { id: string; url: string; mediaType: "image" | "audio" | "video"; mimeType: string; fileSize: number; fileName?: string };
type Props = { media?: StoredMedia[]; align?: "left" | "right"; privateMessage?: boolean; onContentLayout?: (width: number) => void };
const WAVE = [7, 12, 18, 11, 22, 15, 9, 20, 13, 24, 16, 10, 21, 14, 8, 18, 12, 6];

function formatDuration(milliseconds?: number) {
  const total = Number.isFinite(milliseconds) ? Math.max(0, Math.floor((milliseconds ?? 0) / 1000)) : 0;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function MessageVideoMedia({ video, privateMessage, onContentLayout }: { video: StoredMedia; privateMessage: boolean; onContentLayout?: (width: number) => void }) {
  const source = useAuthenticatedMediaSource(video.url);
  const [videoOpen, setVideoOpen] = useState(false);
  const [videoDuration, setVideoDuration] = useState<number>();
  const viewport = useWindowDimensions();
  const popupWidth = Math.min(940, Math.max(1, viewport.width - 36));
  const popupHeight = Math.min(520, Math.max(1, viewport.height - 140));
  const videoPlayer = useVideoPlayer(source.uri ? { uri: source.uri, headers: source.headers } : null, (player) => {
    player.muted = true;
  });

  useEffect(() => {
    let active = true;
    setVideoDuration(undefined);
    const syncDuration = (duration: number) => {
      if (active && Number.isFinite(duration) && duration > 0) setVideoDuration(duration * 1000);
    };
    syncDuration(videoPlayer.duration);
    const subscription = videoPlayer.addListener("sourceLoad", ({ duration }) => syncDuration(duration));
    return () => {
      active = false;
      subscription.remove();
    };
  }, [videoPlayer, source.uri]);

  const openVideo = () => {
    videoPlayer.muted = false;
    setVideoOpen(true);
  };
  const closeVideo = () => {
    videoPlayer.pause();
    videoPlayer.currentTime = 0;
    videoPlayer.muted = true;
    setVideoOpen(false);
  };

  return (
    <>
      <Pressable accessibilityLabel="동영상 팝업 열기" onLayout={(event) => onContentLayout?.(event.nativeEvent.layout.width)} onPress={openVideo} style={styles.videoCard}>
        {source.uri && !videoOpen ? <VideoView player={videoPlayer} contentFit="contain" nativeControls={false} playsInline style={styles.videoThumb} /> : null}
        <View style={styles.videoPlayBadge}><Text style={styles.videoPlayText}>▶</Text></View>
        <Text style={styles.videoDuration}>{formatDuration(videoDuration)}</Text>
        {privateMessage ? <View pointerEvents="none" style={styles.privateVideoBorder} /> : null}
      </Pressable>

      <Modal animationType="fade" transparent visible={videoOpen} onRequestClose={closeVideo}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.playerPanel, { width: popupWidth }]}>
            <View style={styles.playerHeader}><Text style={styles.playerTitle}>동영상</Text><Pressable accessibilityLabel="동영상 팝업 닫기" onPress={closeVideo} style={styles.close}><Text style={styles.closeText}>×</Text></Pressable></View>
            <View style={[styles.popupVideoFrame, { height: popupHeight }]}>
              {videoOpen && source.uri ? <VideoView player={videoPlayer} contentFit="contain" nativeControls buttonOptions={{ showNext: false, showPrevious: false, showSeekBackward: true, showSeekForward: true, showPlayPause: true }} playsInline style={styles.popupVideo} /> : null}
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

export default function MessageMedia({ media = [], align = "left", privateMessage = false, onContentLayout }: Props) {
  const audio = media.find((item) => item.mediaType === "audio");
  const video = media.find((item) => item.mediaType === "video");
  const audioSource = useAuthenticatedMediaSource(audio?.url);
  const [playingAudio, setPlayingAudio] = useState(false);
  const [audioPlayer, setAudioPlayer] = useState<AudioPlayer | null>(null);
  const audioPlayerRef = useRef<AudioPlayer | null>(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioPosition, setAudioPosition] = useState(0);
  const [audioVolume, setAudioVolume] = useState(0.8);
  const volumeRef = useRef(audioVolume);
  volumeRef.current = audioVolume;
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioError, setAudioError] = useState("");
  const [volumeTrackWidth, setVolumeTrackWidth] = useState(0);
  const seekTrackWidth = useRef(0);
  const scrubbing = useRef(false);
  const scrubPosition = useRef(0);
  const seekVersion = useRef(0);
  const seekQueue = useRef<Promise<void>>(Promise.resolve());
  const playbackBusy = useRef(false);
  const audioProgress = audioDuration > 0 ? Math.min(1, Math.max(0, audioPosition / audioDuration)) : 0;
  const canSeek = Boolean(audioPlayer && audioDuration > 0);

  useEffect(() => {
    let active = true;
    audioPlayerRef.current = null;
    setAudioPlayer(null);
    setPlayingAudio(false);
    setAudioPosition(0);
    setAudioDuration(0);
    setAudioError("");
    scrubbing.current = false;
    scrubPosition.current = 0;
    seekVersion.current += 1;
    setAudioBusy(Boolean(audioSource.uri));
    if (!audioSource.uri) return;

    const player = createAudioPlayer({ uri: audioSource.uri, headers: audioSource.headers }, { updateInterval: 250 });
    player.volume = volumeRef.current;
    audioPlayerRef.current = player;
    setAudioPlayer(player);

    const onStatus = (status: AudioStatus) => {
      if (!active) return;
      if (status.error) {
        setAudioError("보이스를 불러오지 못했습니다.");
        setAudioBusy(false);
        return;
      }
      if (!status.isLoaded) {
        setAudioBusy(true);
        return;
      }
      if (Number.isFinite(status.duration) && status.duration > 0) setAudioDuration(status.duration * 1000);
      if (!scrubbing.current && Number.isFinite(status.currentTime)) setAudioPosition(status.currentTime * 1000);
      setPlayingAudio(status.playing);
      setAudioBusy(false);
    };
    const subscription = player.addListener("playbackStatusUpdate", onStatus);
    onStatus(player.currentStatus);
    return () => {
      active = false;
      subscription.remove();
      if (audioPlayerRef.current === player) audioPlayerRef.current = null;
      player.remove();
    };
  }, [audioSource.uri, audioSource.headers]);

  useEffect(() => {
    if (audioPlayer) audioPlayer.volume = audioVolume;
  }, [audioPlayer, audioVolume]);

  const updateVolumeFromTouch = (event: GestureResponderEvent) => {
    if (!volumeTrackWidth) return;
    const x = Math.min(volumeTrackWidth, Math.max(0, event.nativeEvent.locationX));
    setAudioVolume(x / volumeTrackWidth);
  };

  const seekAudio = (position: number) => {
    const player = audioPlayerRef.current;
    if (!player || !audioDuration) {
      scrubbing.current = false;
      return;
    }
    const target = Math.min(audioDuration, Math.max(0, position));
    const version = ++seekVersion.current;
    scrubbing.current = true;
    scrubPosition.current = target;
    setAudioPosition(target);
    seekQueue.current = seekQueue.current.catch(() => undefined).then(async () => {
      if (audioPlayerRef.current !== player) return;
      try {
        await player.seekTo(target / 1000);
        if (audioPlayerRef.current === player && version === seekVersion.current) setAudioError("");
      } catch {
        if (audioPlayerRef.current === player && version === seekVersion.current) setAudioError("재생 위치를 변경하지 못했습니다.");
      } finally {
        if (audioPlayerRef.current === player && version === seekVersion.current) scrubbing.current = false;
      }
    });
  };

  const previewSeek = (event: GestureResponderEvent) => {
    if (!canSeek || !seekTrackWidth.current) return;
    const fraction = Math.min(1, Math.max(0, (event.nativeEvent.locationX - 4) / Math.max(1, seekTrackWidth.current - 8)));
    scrubbing.current = true;
    scrubPosition.current = fraction * audioDuration;
    setAudioPosition(scrubPosition.current);
  };
  const finishSeek = () => seekAudio(scrubPosition.current);
  const seekKeyboardProps = Platform.OS === "web" ? {
    tabIndex: canSeek ? 0 as const : -1 as const,
    onKeyDown: (event: { key: string; preventDefault: () => void }) => {
      if (!canSeek) return;
      const target = event.key === "ArrowRight" || event.key === "ArrowUp" ? audioPosition + 5000
        : event.key === "ArrowLeft" || event.key === "ArrowDown" ? audioPosition - 5000
        : event.key === "Home" ? 0 : event.key === "End" ? audioDuration : undefined;
      if (target !== undefined) { event.preventDefault(); seekAudio(target); }
    },
  } : {};

  const toggleAudio = async () => {
    const player = audioPlayerRef.current;
    if (!player || playbackBusy.current) return;
    playbackBusy.current = true;
    try {
      const status = player.currentStatus;
      if (!status.isLoaded) return;
      if (status.playing) {
        player.pause();
        setPlayingAudio(false);
        await player.seekTo(0);
        if (audioPlayerRef.current === player) {
          scrubbing.current = false;
          scrubPosition.current = 0;
          setAudioPosition(0);
        }
      }
      else {
        if (status.didJustFinish || status.duration > 0 && status.currentTime >= status.duration) await player.seekTo(0);
        player.play();
        setPlayingAudio(true);
      }
      if (audioPlayerRef.current === player) setAudioError("");
    } catch {
      if (audioPlayerRef.current === player) setAudioError("보이스 재생에 실패했습니다.");
    } finally {
      playbackBusy.current = false;
    }
  };

  return (
    <View style={[styles.wrap, align === "right" ? styles.wrapRight : styles.wrapLeft]}>
      {audio ? (
        <>
          <View onLayout={(event) => onContentLayout?.(event.nativeEvent.layout.width)} style={[styles.audioPill, privateMessage && styles.privateAudioBorder]}>
          <View style={styles.audioTopRow}>
            <Pressable accessibilityLabel={playingAudio ? "보이스 일시정지" : "보이스 재생"} accessibilityRole="button" disabled={!audioPlayer || audioBusy} onPress={() => void toggleAudio()} style={[styles.audioPlay, (!audioPlayer || audioBusy) && styles.disabledControl]}><Text style={styles.audioPlayText}>{playingAudio ? "Ⅱ" : "▶"}</Text></Pressable>
              <View style={styles.waveform} onLayout={(event) => { seekTrackWidth.current = event.nativeEvent.layout.width; }}>
                {WAVE.map((height, index) => <View key={index} style={[styles.waveBar, { height }]} />)}
                <View
                  {...seekKeyboardProps}
                  accessibilityRole="adjustable"
                  accessibilityLabel="보이스 재생 위치"
                  accessibilityState={{ disabled: !canSeek }}
                  accessibilityValue={{ min: 0, max: Math.floor(audioDuration / 1000), now: Math.floor(audioPosition / 1000), text: `${formatDuration(audioPosition)} / ${formatDuration(audioDuration)}` }}
                  accessibilityActions={[{ name: "increment", label: "5초 앞으로" }, { name: "decrement", label: "5초 뒤로" }]}
                  onAccessibilityAction={(event) => seekAudio(audioPosition + (event.nativeEvent.actionName === "increment" ? 5000 : -5000))}
                  onStartShouldSetResponder={() => canSeek}
                  onMoveShouldSetResponder={() => canSeek}
                  onResponderGrant={previewSeek}
                  onResponderMove={previewSeek}
                  onResponderRelease={finishSeek}
                  onResponderTerminate={finishSeek}
                  onResponderTerminationRequest={() => false}
                  style={[styles.seekOverlay, !canSeek && styles.disabledControl]}
                >
                  <View pointerEvents="none" style={styles.seekTrack}>
                    <View style={[styles.seekFill, { width: `${audioProgress * 100}%` }]} />
                    <View style={[styles.seekThumb, { left: `${audioProgress * 100}%` }]} />
                  </View>
                </View>
              </View>
              <View style={styles.audioMeta}><Text style={styles.duration}>{formatDuration(audioDuration)}</Text></View>
            </View>
            <View style={styles.volumeRow}>
              <Text style={styles.volumeLabel}>VOL</Text>
              <View
                accessibilityRole="adjustable"
                accessibilityLabel="보이스 음량"
                accessibilityValue={{ min: 0, max: 100, now: Math.round(audioVolume * 100) }}
                onLayout={(event) => setVolumeTrackWidth(event.nativeEvent.layout.width)}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderGrant={updateVolumeFromTouch}
                onResponderMove={updateVolumeFromTouch}
                style={styles.volumeTouchArea}
              >
                <View pointerEvents="none" style={styles.volumeTrack}>
                  <View style={[styles.volumeFill, { width: `${audioVolume * 100}%` }]} />
                  <View style={[styles.volumeThumb, { left: `${audioVolume * 100}%` }]} />
                </View>
              </View>
              <Text style={styles.volumeValue}>{Math.round(audioVolume * 100)}%</Text>
            </View>
          </View>
          {audioError ? <Text style={styles.audioError}>{audioError}</Text> : null}
        </>
      ) : null}

      {video ? <MessageVideoMedia video={video} privateMessage={privateMessage} onContentLayout={onContentLayout} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: "stretch", gap: 8, marginTop: 6, maxWidth: "100%", width: "100%" },
  wrapLeft: { alignItems: "flex-start" },
  wrapRight: { alignItems: "flex-end" },
  audioPill: { backgroundColor: "#16c5d4", borderColor: "transparent", borderRadius: 20, borderWidth: 1.5, gap: 4, height: 64, maxWidth: "100%", paddingHorizontal: 10, paddingVertical: 6, width: 240 },
  privateAudioBorder: { borderColor: "#f0d96a", borderWidth: 2, elevation: 4, shadowColor: "#f0d96a", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.72, shadowRadius: 4 },
  audioTopRow: { alignItems: "center", flexDirection: "row", gap: 8, minHeight: 28 },
  audioPlay: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.96)", borderRadius: 14, flexShrink: 0, height: 28, justifyContent: "center", width: 28 },
  disabledControl: { opacity: 0.45 },
  audioPlayText: { color: "#16b9ca", fontSize: 17, fontWeight: "900", marginLeft: 2 },
  waveform: { alignItems: "center", flex: 1, flexDirection: "row", gap: 2, height: 28, justifyContent: "space-between", minWidth: 0, overflow: "hidden", position: "relative" },
  waveBar: { backgroundColor: "rgba(255,255,255,0.55)", borderRadius: 2, minWidth: 2 },
  audioMeta: { alignItems: "flex-end", flexShrink: 0, width: 42 },
  duration: { color: "#ffffff", fontSize: 12, fontVariant: ["tabular-nums"], fontWeight: "800", textAlign: "right", width: "100%" },
  seekOverlay: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0, zIndex: 1 },
  seekTrack: { backgroundColor: "#ffffff", borderRadius: 2, height: 2, left: 4, position: "absolute", right: 4, top: "50%", transform: [{ translateY: -1 }] },
  seekFill: { backgroundColor: "#ffffff", borderRadius: 2, height: 2 },
  seekThumb: { backgroundColor: "#ffffff", borderColor: "rgba(0,0,0,0.16)", borderRadius: 4, borderWidth: 1, height: 8, marginLeft: -4, position: "absolute", top: -3, width: 8 },
  volumeRow: { alignItems: "center", flexDirection: "row", gap: 6, height: 16 },
  volumeLabel: { color: "rgba(255,255,255,0.86)", fontSize: 8, fontWeight: "800", letterSpacing: 0.6, width: 22 },
  volumeTouchArea: { flex: 1, height: 16, justifyContent: "center", minWidth: 30 },
  volumeTrack: { backgroundColor: "rgba(255,255,255,0.35)", borderRadius: 3, height: 3, position: "relative", width: "100%" },
  volumeFill: { backgroundColor: "#ffffff", borderRadius: 3, height: 3 },
  volumeThumb: { backgroundColor: "#ffffff", borderColor: "rgba(0,0,0,0.12)", borderRadius: 5, borderWidth: 1, height: 10, marginLeft: -5, position: "absolute", top: -3.5, width: 10 },
  volumeValue: { color: "#ffffff", fontSize: 9, fontVariant: ["tabular-nums"], fontWeight: "700", textAlign: "right", width: 28 },
  audioError: { color: "#e38b7d", fontSize: 10, maxWidth: 240 },
  videoCard: { alignItems: "center", backgroundColor: "#050505", borderRadius: 10, height: 135, justifyContent: "center", maxWidth: "100%", overflow: "hidden", position: "relative", width: 240 },
  privateVideoBorder: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, borderColor: "#f0d96a", borderRadius: 10, borderWidth: 1.5 },
  videoThumb: { position: "absolute", left: 0, top: 0, height: "100%", width: "100%" },
  videoPlayBadge: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.88)", borderRadius: 27, height: 54, justifyContent: "center", position: "absolute", width: 54 },
  videoPlayText: { color: "#111111", fontSize: 22, marginLeft: 3 },
  videoDuration: { backgroundColor: "rgba(0,0,0,0.72)", borderRadius: 4, bottom: 8, color: "#ffffff", fontSize: 13, fontWeight: "800", paddingHorizontal: 6, paddingVertical: 3, position: "absolute", right: 8 },
  modalBackdrop: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.78)", flex: 1, justifyContent: "center", padding: 18 },
  playerPanel: { backgroundColor: "#080808", borderColor: "#333333", borderRadius: 14, borderWidth: 1, padding: 12 },
  playerHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  playerTitle: { color: "#ffffff", fontSize: 14, fontWeight: "700" },
  close: { alignItems: "center", height: 32, justifyContent: "center", width: 32 }, closeText: { color: "#ffffff", fontSize: 28, fontWeight: "300" },
  popupVideoFrame: { alignItems: "center", backgroundColor: "#000000", borderRadius: 10, justifyContent: "center", overflow: "hidden", width: "100%" },
  popupVideo: { backgroundColor: "#000000", height: "100%", width: "100%" },
});
