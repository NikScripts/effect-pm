/**
 * Native sheet for adding a repo — empty `git init` or clone under the
 * configured main-checkout template.
 *
 * One field accepts a create name, GitHub search text, or a pasteable remote
 * URL. Typing searches and offers a first-row Create “name” suggestion;
 * a parseable remote auto-probes. Clone hits show the owner/org avatar
 * when GitHub provides one. Selecting a hit or resolving a URL shows
 * preview + collapsed preferences (folder name defaults to the remote
 * repo name). Header glass `xmark` / `plus` stay outside the Form. The
 * Create / Clone CTA is the last Form child (not a Section) so it scrolls
 * with content without a grouped well — same action as `plus`. Sheet
 * backdrop is `systemGroupedBackground`.
 *
 * @internal
 */
import * as React from "react";
import { StyleSheet, useColorScheme } from "react-native";
import {
  BottomSheet,
  Button,
  DisclosureGroup,
  Form,
  Group,
  Host,
  HStack,
  Image,
  LabeledContent,
  Picker,
  ProgressView,
  Section,
  Spacer,
  Text,
  TextField,
  useNativeState,
  VStack,
} from "@expo/ui/swift-ui";
import {
  autocorrectionDisabled,
  background,
  bold,
  buttonStyle,
  clipShape,
  controlSize,
  disabled,
  foregroundStyle,
  frame,
  glassEffect,
  imageScale,
  labelStyle,
  multilineTextAlignment,
  onSubmit,
  padding,
  listRowSeparator,
  listRowInsets,
  listRowBackground,
  pickerStyle,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
  tag,
  textInputAutocapitalization,
} from "@expo/ui/swift-ui/modifiers";
import { useAppContext } from "./AppContext";
import { getBackendAddress } from "./settings";
import { colors } from "./colors";
import {
  cloneRepo,
  fetchRepoMeta,
  initRepo,
  parseRemoteInput,
  previewRemote,
  searchGitHubRepos,
  type GitHubSearchHit,
  type RemotePreview,
  type RepoMeta,
} from "./repoCreate";

type Props = {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onCreated: (repoName: string, mainPath: string) => void;
};

/** Matches Form / systemGroupedBackground (see RootNavigator theme notes). */
const SHEET_BACKGROUND = {
  light: "#F2F2F7",
  dark: "#000000",
} as const;

const primaryText = foregroundStyle({ type: "hierarchical", style: "primary" });
const secondaryText = foregroundStyle({ type: "hierarchical", style: "secondary" });
const SEARCH_DEBOUNCE_MS = 350;

/** Circular glass chrome — Composer chip recipe so `frame` actually sizes the disc. */
const HEADER_BUTTON_SIZE = 44;
const glassIconButton = [
  buttonStyle("plain"),
  labelStyle("iconOnly"),
  imageScale("large"),
  frame({ width: HEADER_BUTTON_SIZE, height: HEADER_BUTTON_SIZE }),
  glassEffect({ glass: { variant: "regular", interactive: true }, shape: "circle" }),
] as const;

const isFolderName = (raw: string): boolean =>
  raw.length > 0 && !raw.includes("/") && !raw.includes(":") && !/\s/.test(raw);

const AVATAR_SIZE = 28;
/** Soft continuous corner — org / create / placeholder “squircle”. */
const SQUIRCLE_RADIUS = 7;
const avatarSizeFrame = frame({ width: AVATAR_SIZE, height: AVATAR_SIZE });
const circleClip = [avatarSizeFrame, clipShape("circle")] as const;
const squircleClip = [avatarSizeFrame, clipShape("roundedRectangle", SQUIRCLE_RADIUS)] as const;

/** User avatars are circles; orgs and placeholders are squircles. */
const SuggestionAvatar = (props: {
  readonly avatarUrl: string | undefined;
  readonly ownerKind: "user" | "organization" | undefined;
}): React.ReactElement => {
  const clip = props.ownerKind === "user" ? circleClip : squircleClip;
  return props.avatarUrl !== undefined ? (
    <Image uiImage={props.avatarUrl} modifiers={[...clip]} />
  ) : (
    <Image systemName="shippingbox" size={AVATAR_SIZE} modifiers={[...clip, secondaryText]} />
  );
};

export const NewRepoSheet = (props: Props): React.ReactElement => {
  const { client, address, rootDir } = useAppContext();
  const colorScheme = useColorScheme();
  const queryState = useNativeState("");
  const nameState = useNativeState("");
  const [query, setQuery] = React.useState("");
  const [hits, setHits] = React.useState<ReadonlyArray<GitHubSearchHit>>([]);
  const [searching, setSearching] = React.useState(false);
  const [preview, setPreview] = React.useState<RemotePreview | undefined>(undefined);
  const [meta, setMeta] = React.useState<RepoMeta | undefined>(undefined);
  const [branch, setBranch] = React.useState<string | undefined>(undefined);
  const [probing, setProbing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [prefsOpen, setPrefsOpen] = React.useState(false);
  const [backendAddress, setBackendAddress] = React.useState<string | undefined>(undefined);
  const probeSeq = React.useRef(0);
  const searchSeq = React.useRef(0);

  React.useEffect(() => {
    if (!props.visible) return;
    queryState.set("");
    nameState.set("");
    setQuery("");
    setHits([]);
    setPreview(undefined);
    setMeta(undefined);
    setBranch(undefined);
    setError(undefined);
    setBusy(false);
    setProbing(false);
    setSearching(false);
    setPrefsOpen(false);
    probeSeq.current += 1;
    searchSeq.current += 1;
    // Native states are stable refs; only reset when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.visible]);


  React.useEffect(() => {
    let cancelled = false;
    void getBackendAddress(address).then((backend) => {
      if (!cancelled) setBackendAddress(backend);
    });
    return () => {
      cancelled = true;
    };
  }, [address]);

  const applyFolderName = (repoName: string): void => {
    nameState.set(repoName);
  };

  const runProbe = async (raw: string): Promise<RemotePreview | undefined> => {
    const seq = ++probeSeq.current;
    setProbing(true);
    setError(undefined);
    setHits([]);
    try {
      const next = await previewRemote(client, rootDir, raw);
      if (seq !== probeSeq.current) return undefined;
      setPreview(next);
      applyFolderName(next.remote.name);
      setBranch(next.defaultBranch);
      queryState.set(next.remote.url);
      setQuery(next.remote.url);
      if (backendAddress !== undefined) {
        void fetchRepoMeta(backendAddress, next.remote.owner, next.remote.name).then((m) => {
          if (seq === probeSeq.current) setMeta(m);
        });
      }
      return next;
    } catch (err) {
      if (seq !== probeSeq.current) return undefined;
      setPreview(undefined);
      setMeta(undefined);
      setError(err instanceof Error ? err.message : "Couldn't reach that remote.");
      return undefined;
    } finally {
      if (seq === probeSeq.current) setProbing(false);
    }
  };

  const selectHit = (hit: GitHubSearchHit): void => {
    const short = hit.fullName.split("/")[1] ?? hit.fullName;
    applyFolderName(short);
    setHits([]);
    void runProbe(hit.url);
  };

  const onQueryChange = (text: string): void => {
    setQuery(text);
    setError(undefined);
    if (preview !== undefined) {
      setPreview(undefined);
      setMeta(undefined);
      setBranch(undefined);
      nameState.set("");
    }
  };

  React.useEffect(() => {
    if (!props.visible) return;
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setHits([]);
      setSearching(false);
      searchSeq.current += 1;
      return;
    }

    const parsed = parseRemoteInput(trimmed);
    if (parsed !== undefined) {
      setHits([]);
      setSearching(false);
      searchSeq.current += 1;
      const handle = setTimeout(() => {
        void runProbe(trimmed);
      }, 200);
      return () => clearTimeout(handle);
    }

    if (backendAddress === undefined) {
      setHits([]);
      setSearching(false);
      return;
    }

    const seq = ++searchSeq.current;
    setSearching(true);
    const handle = setTimeout(() => {
      void searchGitHubRepos(backendAddress, trimmed)
        .then((results) => {
          if (seq !== searchSeq.current) return;
          setHits(results);
        })
        .catch(() => {
          if (seq !== searchSeq.current) return;
          setHits([]);
        })
        .finally(() => {
          if (seq === searchSeq.current) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, props.visible, backendAddress]);

  const submit = (): void => {
    setBusy(true);
    setError(undefined);
    void (async () => {
      try {
        if (preview !== undefined) {
          const repoName = nameState.get().trim() || preview.remote.name;
          if (repoName.length === 0) {
            setError("Give the repo a folder name.");
            return;
          }
          const path = await cloneRepo(client, rootDir, preview.remote.url, repoName, branch);
          props.onCreated(repoName, path);
          props.onClose();
          return;
        }

        // Create Repository — empty init from the name in the search field.
        // Read the native field directly; React `query` can lag behind typing.
        const repoName = queryState.get().trim();
        if (repoName.length === 0) {
          setError("Type a name for the new repository.");
          return;
        }
        if (!isFolderName(repoName)) {
          setError("Use a simple folder name (no spaces or slashes).");
          return;
        }
        setQuery(repoName);
        applyFolderName(repoName);
        const path = await initRepo(client, rootDir, repoName);
        props.onCreated(repoName, path);
        props.onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't create the repo.");
      } finally {
        setBusy(false);
      }
    })();
  };

  const destinationPreview =
    preview !== undefined
      ? preview.destination.replace(/\/[^/]+$/, `/${nameState.get().trim() || preview.remote.name}`)
      : undefined;

  const hasSelection = preview !== undefined;
  const primaryLabel = busy
    ? "Working…"
    : hasSelection
      ? "Clone Repository"
      : "Create Repository";

  const typedName = query.trim();
  const showCreateSuggestion =
    !hasSelection &&
    typedName.length > 0 &&
    parseRemoteInput(typedName) === undefined &&
    isFolderName(typedName);
  const showSuggestions = showCreateSuggestion || (!hasSelection && hits.length > 0);

  const createFromTypedName = (): void => {
    if (!showCreateSuggestion || busy || probing) return;
    setBusy(true);
    setError(undefined);
    void (async () => {
      try {
        const repoName = queryState.get().trim() || typedName;
        applyFolderName(repoName);
        const path = await initRepo(client, rootDir, repoName);
        props.onCreated(repoName, path);
        props.onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't create the repo.");
      } finally {
        setBusy(false);
      }
    })();
  };

  const repoTitle =
    preview !== undefined
      ? [
          preview.remote.owner !== undefined ? `${preview.remote.owner}/` : "",
          preview.remote.name,
        ].join("")
      : undefined;

  return (
    <Host style={styles.host} ignoreSafeArea="all" pointerEvents="box-none">
      <BottomSheet
        isPresented={props.visible}
        onIsPresentedChange={(presented) => {
          if (!presented) props.onClose();
        }}
      >
        <Group
          modifiers={[
            presentationDetents(["large", "medium"]),
            presentationDragIndicator("visible"),
            presentationBackground(
              colorScheme === "dark" ? SHEET_BACKGROUND.dark : SHEET_BACKGROUND.light,
            ),
          ]}
        >
          <VStack
            spacing={16}
            modifiers={[
              background(colors.background),
              padding({ top: 20, bottom: 20 }),
            ]}
          >
            {/* Outside Form — more header margin; bigger circular chrome. */}
            <HStack modifiers={[padding({ horizontal: 20, vertical: 10 })]}>
              <Button
                systemImage="xmark"
                label="Close"
                role="cancel"
                onPress={props.onClose}
                modifiers={[...glassIconButton]}
              />
              <Spacer />
              <Text modifiers={[bold()]}>New Repository</Text>
              <Spacer />
              <Button
                systemImage="plus"
                label={primaryLabel}
                onPress={submit}
                modifiers={[...glassIconButton, disabled(busy || probing)]}
              />
            </HStack>

            <Form>
              <Section
                title="Repository"
                footer={
                  <Text modifiers={[secondaryText]}>
                    Type a name to create a new repo, search GitHub, or paste a URL / owner/repo —
                    preview appears automatically.
                  </Text>
                }
              >
                <TextField
                  text={queryState}
                  placeholder="Name, search, or clone URL"
                  onTextChange={onQueryChange}
                  modifiers={[
                    autocorrectionDisabled(),
                    textInputAutocapitalization("never"),
                    onSubmit(() => {
                      const trimmed = queryState.get().trim();
                      if (parseRemoteInput(trimmed) !== undefined) void runProbe(trimmed);
                    }),
                  ]}
                />
                {searching || probing ? <ProgressView /> : null}
              </Section>

              {showSuggestions ? (
                <Section title="Suggestions">
                  {showCreateSuggestion ? (
                    <Button
                      onPress={createFromTypedName}
                      modifiers={[buttonStyle("plain")]}
                    >
                      <HStack
                        spacing={12}
                        alignment="center"
                        modifiers={[frame({ maxWidth: Infinity, alignment: "leading" })]}
                      >
                        <Image
                          systemName="plus"
                          size={16}
                          modifiers={[...squircleClip, secondaryText]}
                        />
                        <Text modifiers={[primaryText, multilineTextAlignment("leading")]}>
                          {`Create “${typedName}”`}
                        </Text>
                      </HStack>
                    </Button>
                  ) : null}
                  {hits.map((hit) => (
                    <Button
                      key={hit.fullName}
                      onPress={() => selectHit(hit)}
                      modifiers={[buttonStyle("plain")]}
                    >
                      <HStack
                        spacing={12}
                        alignment="center"
                        modifiers={[frame({ maxWidth: Infinity, alignment: "leading" })]}
                      >
                        <SuggestionAvatar avatarUrl={hit.avatarUrl} ownerKind={hit.ownerKind} />
                        <VStack
                          spacing={2}
                          alignment="leading"
                          modifiers={[
                            frame({ maxWidth: Infinity, alignment: "leading" }),
                            multilineTextAlignment("leading"),
                          ]}
                        >
                          <Text modifiers={[primaryText, multilineTextAlignment("leading")]}>
                            {hit.fullName}
                          </Text>
                          {hit.description !== undefined && hit.description.length > 0 ? (
                            <Text modifiers={[secondaryText, multilineTextAlignment("leading")]}>
                              {hit.description}
                            </Text>
                          ) : null}
                        </VStack>
                      </HStack>
                    </Button>
                  ))}
                </Section>
              ) : null}

              {hasSelection && preview !== undefined ? (
                <>
                  <Section title="Preview">
                    {repoTitle !== undefined ? (
                      <LabeledContent label="Repo">
                        <Text>{repoTitle}</Text>
                      </LabeledContent>
                    ) : null}
                    {meta?.description !== undefined && meta.description.length > 0 ? (
                      <LabeledContent label="About">
                        <Text modifiers={[secondaryText]}>{meta.description}</Text>
                      </LabeledContent>
                    ) : null}
                    {meta?.language !== undefined ? (
                      <LabeledContent label="Language">
                        <Text>{meta.language}</Text>
                      </LabeledContent>
                    ) : null}
                    {meta?.stars !== undefined ? (
                      <LabeledContent label="Stars">
                        <Text>{String(meta.stars)}</Text>
                      </LabeledContent>
                    ) : null}
                    <LabeledContent label="URL">
                      <Text modifiers={[secondaryText]}>{preview.remote.url}</Text>
                    </LabeledContent>
                    {meta !== undefined && meta.topics.length > 0 ? (
                      <LabeledContent label="Topics">
                        <Text modifiers={[secondaryText]}>{meta.topics.join(", ")}</Text>
                      </LabeledContent>
                    ) : null}
                    {meta !== undefined && meta.ruleFiles.length > 0 ? (
                      <LabeledContent label="In repo">
                        <Text modifiers={[secondaryText]}>{meta.ruleFiles.join(", ")}</Text>
                      </LabeledContent>
                    ) : null}
                  </Section>

                  <Section>
                    <DisclosureGroup
                      label="Repository preferences"
                      isExpanded={prefsOpen}
                      onIsExpandedChange={setPrefsOpen}
                    >
                      <LabeledContent label="Folder name">
                        <TextField
                          text={nameState}
                          placeholder="Folder name"
                          modifiers={[
                            autocorrectionDisabled(),
                            textInputAutocapitalization("never"),
                            secondaryText,
                            multilineTextAlignment("trailing"),
                            frame({ maxWidth: Infinity, alignment: "trailing" }),
                          ]}
                        />
                      </LabeledContent>
                      <Picker
                        label="Branch"
                        selection={branch ?? preview.defaultBranch}
                        onSelectionChange={(value) => {
                          if (typeof value === "string") setBranch(value);
                        }}
                        modifiers={[pickerStyle("menu")]}
                      >
                        {preview.branches.map((b) => (
                          <Text key={b} modifiers={[tag(b)]}>
                            {b}
                          </Text>
                        ))}
                      </Picker>
                      {destinationPreview !== undefined ? (
                        <LabeledContent label="Destination">
                          <Text
                            modifiers={[
                              secondaryText,
                              multilineTextAlignment("trailing"),
                              frame({ maxWidth: Infinity, alignment: "trailing" }),
                            ]}
                          >
                            {destinationPreview}
                          </Text>
                        </LabeledContent>
                      ) : null}
                    </DisclosureGroup>
                  </Section>
                </>
              ) : null}

              {error !== undefined ? (
                <Section>
                  <Text modifiers={[foregroundStyle("#FF3B30")]}>{error}</Text>
                </Section>
              ) : null}
              {/* Not a Section — scrolls with Form, no grouped well. */}
              <Button
                label={primaryLabel}
                onPress={submit}
                modifiers={[
                  buttonStyle("borderedProminent"),
                  controlSize("large"),
                  disabled(busy || probing),
                  frame({ maxWidth: Infinity, minHeight: 56 }),
                  listRowBackground("clear"),
                  listRowSeparator("hidden"),
                  listRowInsets({ top: 12, leading: 20, bottom: 12, trailing: 20 }),
                ]}
              />
              {busy ? (
                <ProgressView
                  modifiers={[
                    listRowBackground("clear"),
                    listRowSeparator("hidden"),
                  ]}
                />
              ) : null}
            </Form>
          </VStack>
        </Group>
      </BottomSheet>
    </Host>
  );
};

const styles = StyleSheet.create({
  // Tiny host — the sheet presents modally; this only anchors SwiftUI.
  host: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
  },
});
