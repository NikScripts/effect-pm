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
 * with content without a grouped well — same action as `plus`. Search and
 * probe loading use `redacted` skeleton rows (suggestions / preview), not a
 * spinner in the search field. Create “name” selects a draft and opens
 * preferences. Plus / Create with a typed name selects that draft first; a
 * second press (or Create after select) commits. Buttons stay disabled when
 * there is nothing valid to select or create. Sheet backdrop is
 * `systemGroupedBackground`.
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
  Section,
  Spacer,
  Text,
  TextField,
  useNativeState,
  VStack,
} from "@expo/ui/swift-ui";
import {
  autocorrectionDisabled,
  aspectRatio,
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
  redacted,
  resizable,
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
  previewInitDestination,
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
    <Image
      uiImage={props.avatarUrl}
      modifiers={[resizable(), aspectRatio({ contentMode: "fill" }), ...clip]}
    />
  ) : (
    <Image systemName="shippingbox" size={AVATAR_SIZE} modifiers={[...clip, secondaryText]} />
  );
};

/** Fake suggestion row — `redacted` turns the text/icon into a native skeleton. */
const SuggestionSkeleton = (): React.ReactElement => (
  <HStack
    spacing={12}
    alignment="center"
    modifiers={[
      frame({ maxWidth: Infinity, alignment: "leading" }),
      redacted("placeholder"),
    ]}
  >
    <Image systemName="shippingbox" size={AVATAR_SIZE} modifiers={[...squircleClip]} />
    <VStack
      spacing={2}
      alignment="leading"
      modifiers={[frame({ maxWidth: Infinity, alignment: "leading" })]}
    >
      <Text modifiers={[primaryText]}>owner/repository-name</Text>
      <Text modifiers={[secondaryText]}>Repository description goes here</Text>
    </VStack>
  </HStack>
);

/** Preview meta placeholders while GitHub details load. */
const PreviewMetaSkeleton = (): React.ReactElement => (
  <>
    <LabeledContent label="About">
      <Text modifiers={[secondaryText, redacted("placeholder")]}>
        Loading description placeholder text
      </Text>
    </LabeledContent>
    <LabeledContent label="Language">
      <Text modifiers={[redacted("placeholder")]}>TypeScript</Text>
    </LabeledContent>
    <LabeledContent label="Stars">
      <Text modifiers={[redacted("placeholder")]}>1234</Text>
    </LabeledContent>
  </>
);

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
  const [metaLoading, setMetaLoading] = React.useState(false);
  const [createDraft, setCreateDraft] = React.useState<string | undefined>(undefined);
  const [createDestination, setCreateDestination] = React.useState<string | undefined>(undefined);
  const [folderEpoch, setFolderEpoch] = React.useState(0);
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
    setMetaLoading(false);
    setCreateDraft(undefined);
    setCreateDestination(undefined);
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
    setCreateDraft(undefined);
    setCreateDestination(undefined);
    try {
      const next = await previewRemote(client, rootDir, raw);
      if (seq !== probeSeq.current) return undefined;
      setPreview(next);
      applyFolderName(next.remote.name);
      setBranch(next.defaultBranch);
      queryState.set(next.remote.url);
      setQuery(next.remote.url);
      if (backendAddress !== undefined) {
        setMetaLoading(true);
        void fetchRepoMeta(backendAddress, next.remote.owner, next.remote.name)
          .then((m) => {
            if (seq === probeSeq.current) setMeta(m);
          })
          .finally(() => {
            if (seq === probeSeq.current) setMetaLoading(false);
          });
      } else {
        setMetaLoading(false);
      }
      return next;
    } catch (err) {
      if (seq !== probeSeq.current) return undefined;
      setPreview(undefined);
      setMeta(undefined);
      setMetaLoading(false);
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
    if (preview !== undefined || createDraft !== undefined) {
      setPreview(undefined);
      setMeta(undefined);
      setMetaLoading(false);
      setCreateDraft(undefined);
      setCreateDestination(undefined);
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

  // Keep create-destination preview in sync with the folder-name field.
  React.useEffect(() => {
    if (createDraft === undefined) {
      setCreateDestination(undefined);
      return;
    }
    let cancelled = false;
    const folder = nameState.get().trim() || createDraft;
    void previewInitDestination(client, rootDir, folder).then((dest) => {
      if (!cancelled) setCreateDestination(dest);
    });
    return () => {
      cancelled = true;
    };
    // nameState is a stable native ref; re-run when draft changes or prefs open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createDraft, client, rootDir, prefsOpen, folderEpoch]);

  const submit = (): void => {
    if (busy || probing) return;
    void (async () => {
      try {
        if (preview !== undefined) {
          const repoName = nameState.get().trim() || preview.remote.name;
          if (!isFolderName(repoName)) return;
          setBusy(true);
          setError(undefined);
          const path = await cloneRepo(client, rootDir, preview.remote.url, repoName, branch);
          props.onCreated(repoName, path);
          props.onClose();
          return;
        }

        if (createDraft === undefined) return;
        const repoName = nameState.get().trim() || createDraft;
        if (!isFolderName(repoName)) return;
        setBusy(true);
        setError(undefined);
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
      : createDraft !== undefined
        ? (createDestination !== undefined
            ? createDestination.replace(/\/[^/]+$/, `/${nameState.get().trim() || createDraft}`)
            : createDestination)
        : undefined;

  const hasCloneSelection = preview !== undefined;
  const hasCreateSelection = createDraft !== undefined;
  const hasSelection = hasCloneSelection || hasCreateSelection;
  const folderForAction =
    hasCloneSelection
      ? nameState.get().trim() || preview!.remote.name
      : hasCreateSelection
        ? nameState.get().trim() || createDraft!
        : "";
  const typedName = query.trim();
  const showCreateSuggestion =
    !hasSelection &&
    typedName.length > 0 &&
    parseRemoteInput(typedName) === undefined &&
    isFolderName(typedName);
  const showSuggestions =
    showCreateSuggestion || (!hasSelection && (hits.length > 0 || searching));

  /** Select create — show prefs; do not init until Create Repository / plus. */
  const selectCreateDraft = (): void => {
    if (busy || probing) return;
    const repoName = (queryState.get().trim() || typedName).trim();
    if (!isFolderName(repoName)) return;
    setError(undefined);
    setHits([]);
    setPreview(undefined);
    setMeta(undefined);
    setMetaLoading(false);
    applyFolderName(repoName);
    setCreateDraft(repoName);
    setPrefsOpen(true);
  };

  const canSubmit =
    !busy &&
    !probing &&
    hasSelection &&
    isFolderName(folderForAction);
  /** Plus / CTA: with a typed name and no selection, select the create draft
   * (show form). With a draft or clone selected, commit. Otherwise disabled. */
  const canPrimary = canSubmit || (!busy && !probing && showCreateSuggestion);
  const primaryLabel = busy
    ? "Working…"
    : hasCloneSelection
      ? "Clone Repository"
      : "Create Repository";
  const onPrimaryPress = (): void => {
    if (hasSelection) {
      submit();
      return;
    }
    if (showCreateSuggestion) selectCreateDraft();
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
                onPress={onPrimaryPress}
                modifiers={[...glassIconButton, disabled(!canPrimary)]}
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
              </Section>

              {showSuggestions ? (
                <Section title="Suggestions">
                  {showCreateSuggestion ? (
                    <Button
                      onPress={selectCreateDraft}
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
                  {searching
                    ? [0, 1, 2].map((i) => <SuggestionSkeleton key={`skel-${i}`} />)
                    : null}
                </Section>
              ) : null}

              {probing && !hasSelection ? (
                <Section title="Preview">
                  <LabeledContent label="Repo">
                    <Text modifiers={[redacted("placeholder")]}>owner/repository</Text>
                  </LabeledContent>
                  <PreviewMetaSkeleton />
                  <LabeledContent label="URL">
                    <Text modifiers={[secondaryText, redacted("placeholder")]}>
                      https://github.com/owner/repository.git
                    </Text>
                  </LabeledContent>
                </Section>
              ) : null}

              {hasCreateSelection && createDraft !== undefined ? (
                <>
                  <Section title="Preview">
                    <LabeledContent label="Repo">
                      <Text>{createDraft}</Text>
                    </LabeledContent>
                    <LabeledContent label="Kind">
                      <Text modifiers={[secondaryText]}>New empty repository</Text>
                    </LabeledContent>
                  </Section>
                  <Section title="Repository preferences">
                    <LabeledContent label="Folder name">
                      <TextField
                        text={nameState}
                        placeholder="Folder name"
                        onTextChange={() => setFolderEpoch((n) => n + 1)}
                        modifiers={[
                          autocorrectionDisabled(),
                          textInputAutocapitalization("never"),
                          secondaryText,
                          multilineTextAlignment("trailing"),
                          frame({ maxWidth: Infinity, alignment: "trailing" }),
                        ]}
                      />
                    </LabeledContent>
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
                    ) : (
                      <LabeledContent label="Destination">
                        <Text modifiers={[secondaryText, redacted("placeholder")]}>
                          /path/to/repo/main
                        </Text>
                      </LabeledContent>
                    )}
                  </Section>
                </>
              ) : null}

              {hasCloneSelection && preview !== undefined ? (
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
                    {metaLoading && meta === undefined ? <PreviewMetaSkeleton /> : null}
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
                          onTextChange={() => setFolderEpoch((n) => n + 1)}
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
                onPress={onPrimaryPress}
                modifiers={[
                  buttonStyle("borderedProminent"),
                  controlSize("large"),
                  disabled(!canPrimary),
                  frame({ maxWidth: Infinity, minHeight: 56 }),
                  listRowBackground("clear"),
                  listRowSeparator("hidden"),
                  listRowInsets({ top: 12, leading: 20, bottom: 12, trailing: 20 }),
                ]}
              />
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
