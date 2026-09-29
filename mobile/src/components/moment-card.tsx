import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { recordedDateLabel } from "../lib/dates";
import {
  photoDeliveryPath,
  videoPosterPath,
  type TimelineMoment,
} from "../lib/journal";
import { colors, record } from "../lib/theme";
import { PrivateImage } from "./private-image";

function kindLabel(moment: TimelineMoment) {
  if (moment.kind === "insight") return "An insight";
  if (moment.kind === "photo") return "A photo";
  if (moment.kind === "video") return "A video";
  if (moment.kind === "milestone") return "A milestone";
  if (moment.kind === "location") return "A place";
  return "A thought";
}

export function MomentCard({
  moment,
  circleName,
  showCircle,
  headers,
}: Readonly<{
  moment: TimelineMoment;
  circleName?: string;
  showCircle: boolean;
  headers?: Record<string, string> | null;
}>) {
  const photo = moment.photos[0];
  const photoPath =
    moment.kind === "photo"
      ? photoDeliveryPath(moment.id, photo?.id)
      : undefined;
  const posterPath =
    (moment.kind === "video" || moment.kind === "insight") && moment.hasPoster
      ? videoPosterPath(moment.id)
      : undefined;
  const sourceHost = moment.sourceUrl ? safeHost(moment.sourceUrl) : undefined;
  const showChips =
    (showCircle && Boolean(circleName)) ||
    moment.audience === "just_me" ||
    moment.photos.length > 1;

  return (
    <View style={styles.card}>
      <Text style={styles.name}>{moment.personName}</Text>
      <Text style={styles.meta}>
        {recordedDateLabel(moment.occurredOn)}
        {"  ·  "}
        {kindLabel(moment)}
      </Text>
      {showChips ? (
        <View style={styles.chips}>
          {showCircle && circleName ? (
            <Text style={styles.chip}>{circleName}</Text>
          ) : null}
          {moment.audience === "just_me" ? (
            <Text style={styles.chip}>Just me</Text>
          ) : null}
          {moment.photos.length > 1 ? (
            <Text style={styles.chip}>{moment.photos.length} photos</Text>
          ) : null}
        </View>
      ) : null}
      {moment.kind === "insight" && moment.title ? (
        <Text style={styles.attribution}>{moment.title}</Text>
      ) : null}
      {moment.kind === "milestone" && moment.title ? (
        <Text style={styles.body}>{moment.title}</Text>
      ) : null}
      {moment.body ? <Text style={styles.body}>{moment.body}</Text> : null}
      {moment.placeName ? (
        <Text style={styles.meta}>{moment.placeName}</Text>
      ) : null}
      {photoPath ? (
        <PrivateImage
          path={photoPath}
          width={photo?.width}
          height={photo?.height}
          label={`Photo from ${moment.personName}`}
          headers={headers}
        />
      ) : null}
      {posterPath ? (
        <PrivateImage
          path={posterPath}
          label={`Video poster from ${moment.personName}`}
          headers={headers}
        />
      ) : null}
      {moment.kind === "video" && !posterPath ? (
        <Text style={styles.meta}>Video</Text>
      ) : null}
      {sourceHost && moment.sourceUrl ? (
        <Pressable
          accessibilityRole="link"
          onPress={() => {
            if (moment.sourceUrl) void Linking.openURL(moment.sourceUrl);
          }}
        >
          <Text style={styles.source}>{sourceHost}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function safeHost(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return undefined;
  }
}

const styles = StyleSheet.create({
  card: {
    gap: 8,
    paddingVertical: 18,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  name: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: "600",
  },
  body: {
    color: colors.ink,
    fontSize: 16,
    lineHeight: 23,
  },
  attribution: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "600",
  },
  meta: {
    ...record,
    fontSize: 12,
    lineHeight: 16,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  chip: {
    ...record,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    color: colors.muted,
    fontSize: 11,
  },
  source: {
    ...record,
    fontSize: 12,
    textDecorationLine: "underline",
  },
});
