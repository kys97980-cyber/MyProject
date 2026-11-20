import { useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import AuthenticatedImage from "@/components/AuthenticatedImage";

type MessageImagesProps = { imageUris?: string[]; legacyImageUri?: string; roundedPopup?: boolean; align?: "left" | "right"; privateMessage?: boolean; onContentLayout?: (width: number) => void };
type Size = { width: number; height: number };
const MAX_WIDTH = 240;
const MAX_HEIGHT = 260;

function fitSize(size: Size): Size {
  const ratio = size.width / Math.max(size.height, 1);
  const scale = Math.min(1, MAX_WIDTH / Math.max(size.width, 1), MAX_HEIGHT / Math.max(size.height, 1));
  return { width: Math.max(80, Math.round(size.width * scale)), height: Math.max(80, Math.round(size.height * scale)) || Math.round(MAX_WIDTH / ratio) };
}

export default function MessageImages({ imageUris, legacyImageUri, roundedPopup = false, align = "left", privateMessage = false, onContentLayout }: MessageImagesProps) {
  const images = useMemo(() => imageUris?.length ? imageUris : legacyImageUri ? [legacyImageUri] : [], [imageUris, legacyImageUri]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [sizes, setSizes] = useState<Record<string, Size>>({});
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const popupWidth = Math.min(940, Math.max(1, viewportWidth - 36));
  const popupHeight = Math.min(520, Math.max(1, viewportHeight - 190));
  const multiImageGridWidth = Math.min(270, Math.max(160, (viewportWidth - 40) * 0.82));
  const multiImageCellSize = (multiImageGridWidth - 6) / 2;
  if (!images.length) return null;
  const selectedUri = selectedIndex === null ? undefined : images[selectedIndex];
  return (
    <>
      <View onLayout={(event) => onContentLayout?.(event.nativeEvent.layout.width)} style={[styles.grid, align === "right" ? styles.gridRight : styles.gridLeft, images.length > 1 && { width: multiImageGridWidth }]}>
        {images.map((uri, index) => {
          const size = sizes[uri] ?? { width: 180, height: 180 };
          const tileSize = images.length > 1 ? { width: multiImageCellSize, height: multiImageCellSize } : size;
          return (
            <Pressable key={`${uri}-${index}`} accessibilityLabel={`이미지 ${index + 1} 확대`} onPress={() => setSelectedIndex(index)} style={[styles.frame, tileSize]}>
              <AuthenticatedImage uri={uri} onLoad={(event) => {
                const dimensions = event.source;
                if (dimensions?.width && dimensions?.height) setSizes((current) => ({ ...current, [uri]: fitSize({ width: dimensions.width, height: dimensions.height }) }));
              }} resizeMode={images.length > 1 ? "cover" : "contain"} style={tileSize} />
              {privateMessage ? <View pointerEvents="none" style={styles.privateBorder} /> : null}
            </Pressable>
          );
        })}
      </View>
      <Modal animationType="fade" transparent visible={selectedIndex !== null} onRequestClose={() => setSelectedIndex(null)}>
        {roundedPopup ? (
          <View style={styles.roundedBackdrop}>
            <Pressable accessibilityLabel="이미지 팝업 바깥 닫기" onPress={() => setSelectedIndex(null)} style={StyleSheet.absoluteFill} />
            <View style={[styles.popupPanel, { width: popupWidth }]}>
              <View style={styles.popupHeader}>
                <Text style={styles.popupTitle}>이미지</Text>
                <Pressable accessibilityLabel="이미지 팝업 닫기" onPress={() => setSelectedIndex(null)} style={styles.popupClose}>
                  <Text style={styles.popupCloseText}>×</Text>
                </Pressable>
              </View>
              <View style={[styles.popupImageFrame, { height: popupHeight }]}>
                {selectedUri ? <AuthenticatedImage uri={selectedUri} resizeMode="contain" style={styles.popupImage} /> : null}
                {images.length > 1 && selectedIndex !== null ? (
                  <View pointerEvents="box-none" style={styles.popupNavigation}>
                    <Pressable
                      accessibilityLabel="이전 이미지"
                      accessibilityState={{ disabled: selectedIndex === 0 }}
                      disabled={selectedIndex === 0}
                      onPress={() => setSelectedIndex((current) => current === null ? 0 : Math.max(0, current - 1))}
                      style={[styles.popupNavButton, selectedIndex === 0 && styles.popupNavDisabled]}
                    ><Text style={styles.popupNavArrow}>‹</Text></Pressable>
                    <Pressable
                      accessibilityLabel="다음 이미지"
                      accessibilityState={{ disabled: selectedIndex === images.length - 1 }}
                      disabled={selectedIndex === images.length - 1}
                      onPress={() => setSelectedIndex((current) => current === null ? 0 : Math.min(images.length - 1, current + 1))}
                      style={[styles.popupNavButton, selectedIndex === images.length - 1 && styles.popupNavDisabled]}
                    ><Text style={styles.popupNavArrow}>›</Text></Pressable>
                  </View>
                ) : null}
              </View>
              {images.length > 1 ? <Text style={styles.popupCounter}>{selectedIndex !== null ? `${selectedIndex + 1} / ${images.length}` : ""}</Text> : null}
            </View>
          </View>
        ) : (
          <View style={styles.modalBackdrop}>
            <Pressable onPress={() => setSelectedIndex(null)} style={styles.closeArea}><Text style={styles.closeText}>×</Text></Pressable>
            {selectedUri ? <AuthenticatedImage uri={selectedUri} resizeMode="contain" style={styles.fullImage} /> : null}
            {images.length > 1 ? <Text style={styles.counter}>{selectedIndex !== null ? `${selectedIndex + 1} / ${images.length}` : ""}</Text> : null}
          </View>
        )}
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6, maxWidth: "100%" },
  gridLeft: { alignSelf: "flex-start" },
  gridRight: { alignSelf: "flex-end" },
  frame: { backgroundColor: "#111111", borderRadius: 10, overflow: "hidden" },
  privateBorder: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, borderColor: "#f0d96a", borderRadius: 10, borderWidth: 1.5 },
  modalBackdrop: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.94)", flex: 1, justifyContent: "center", padding: 18 },
  closeArea: { alignItems: "center", height: 44, justifyContent: "center", position: "absolute", right: 14, top: 18, width: 44, zIndex: 2 },
  closeText: { color: "#ffffff", fontSize: 34, fontWeight: "300" },
  fullImage: { height: "82%", width: "94%" },
  counter: { bottom: 28, color: "#ffffff", fontSize: 12, position: "absolute" },
  roundedBackdrop: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.78)", flex: 1, justifyContent: "center", padding: 18 },
  popupPanel: { backgroundColor: "#080808", borderColor: "#333333", borderRadius: 14, borderWidth: 1, padding: 12 },
  popupHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  popupTitle: { color: "#ffffff", fontSize: 14, fontWeight: "700" },
  popupClose: { alignItems: "center", height: 32, justifyContent: "center", width: 32 },
  popupCloseText: { color: "#ffffff", fontSize: 28, fontWeight: "300" },
  popupImageFrame: { alignItems: "center", backgroundColor: "#000000", borderRadius: 10, justifyContent: "center", overflow: "hidden", width: "100%" },
  popupImage: { height: "100%", width: "100%" },
  popupNavigation: { alignItems: "center", bottom: 0, flexDirection: "row", justifyContent: "space-between", left: 10, position: "absolute", right: 10, top: 0 },
  popupNavButton: { alignItems: "center", backgroundColor: "transparent", height: 56, justifyContent: "center", width: 42 },
  popupNavDisabled: { opacity: 0.3 },
  popupNavArrow: { color: "#ffffff", fontSize: 44, lineHeight: 52, textShadowColor: "rgba(0,0,0,0.8)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  popupCounter: { color: "#ffffff", fontSize: 12, marginTop: 9, textAlign: "center" },
});
