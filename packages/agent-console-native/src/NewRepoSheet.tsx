/**
 * Native sheet for adding a repo — empty `git init` or clone under the
 * configured main-checkout template.
 *
 * One field accepts GitHub search text or a pasteable remote URL. Typing
 * searches; a parseable remote auto-probes. Selecting a hit or resolving a
 * URL shows preview + collapsed preferences (folder name defaults to the
 * remote repo name). Header glass `xmark` / `plus` and the bottom Create /
 * Clone CTA sit outside `Form` sections so they are not wrapped in wells.
 *
 * @internal
 */
import * as React from "react";
import { StyleSheet } from "react-native";
import {
  BottomSheet,
  Button,
  DisclosureGroup,
  Form,
  Group,
  Host,
  HStack,
  LabeledContent,
  List,
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
  bold,
  buttonStyle,
  controlSize,
  disabled,
  foregroundStyle,
  frame,
  imageScale,
  labelStyle,
  listStyle,
  onSubmit,
  padding,
  pickerStyle,
  presentationDetents,
  presentationDragIndicator,
  tag,
  textInputAutocapitalization,
} from "@expo/ui/swift-ui/modifiers";
import { useAppContext } from "./AppContext";
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

const secondaryText = foregroundStyle({ type: "hierarchical", style: "secondary" });
const SEARCH_DEBOUNCE_MS = 350;

const glassIconButton = [
  buttonStyle("glass"),
  labelStyle("iconOnly"),
  imageScale("medium"),
  frame({ width: 36, height: 36 }),
] as const;

const isFolderName = (raw: string): boolean =>
  raw.length > 0 && !raw.includes("/") && !raw.includes(":") && !/\s/.test(raw);

export const NewRepoSheet = (props: Props): React.ReactElement => {
  const { client, rootDir } = useAppContext();
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
      void fetchRepoMeta(client, rootDir, next.remote.owner, next.remote.name).then((m) => {
        if (seq === probeSeq.current) setMeta(m);
      });
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

    const seq = ++searchSeq.current;
    setSearching(true);
    const handle = setTimeout(() => {
      void searchGitHubRepos(client, rootDir, trimmed)
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
  }, [query, props.visible, client, rootDir]);

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

        const fromField = nameState.get().trim();
        const fromQuery = query.trim();
        const repoName = fromField.length > 0 ? fromField : isFolderName(fromQuery) ? fromQuery : "";
        if (repoName.length === 0) {
          setError("Pick a repository to clone, or type a folder name to create one.");
          return;
        }
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
          ]}
        >
          <VStack spacing={12} modifiers={[padding({ top: 8, bottom: 16 })]}>
            {/* Header chrome — outside Form so it is not an inset well. */}
            <HStack modifiers={[padding({ horizontal: 16 })]}>
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
                    Search GitHub, or paste a URL / owner/repo — preview appears automatically.
                  </Text>
                }
              >
                <TextField
                  text={queryState}
                  placeholder="Search or paste clone URL"
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

              {!hasSelection && hits.length > 0 ? (
                <Section title="Suggestions">
                  <List modifiers={[listStyle("plain")]}>
                    {hits.map((hit) => (
                      <Button key={hit.fullName} onPress={() => selectHit(hit)}>
                        <VStack>
                          <Text>{hit.fullName}</Text>
                          {hit.description !== undefined && hit.description.length > 0 ? (
                            <Text modifiers={[secondaryText]}>{hit.description}</Text>
                          ) : null}
                        </VStack>
                      </Button>
                    ))}
                  </List>
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
                      <TextField
                        text={nameState}
                        placeholder="Folder name"
                        modifiers={[
                          autocorrectionDisabled(),
                          textInputAutocapitalization("never"),
                        ]}
                      />
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
                          <Text modifiers={[secondaryText]}>{destinationPreview}</Text>
                        </LabeledContent>
                      ) : null}
                    </DisclosureGroup>
                  </Section>
                </>
              ) : null}

              {!hasSelection ? (
                <Section
                  title="Or create empty"
                  footer={
                    <Text modifiers={[secondaryText]}>
                      Without a selection, Create Repository inits a new git repo. Folder name
                      defaults to what you typed when it looks like a simple name.
                    </Text>
                  }
                >
                  <TextField
                    text={nameState}
                    placeholder="Folder name (optional)"
                    modifiers={[
                      autocorrectionDisabled(),
                      textInputAutocapitalization("never"),
                      onSubmit(submit),
                    ]}
                  />
                </Section>
              ) : null}

              {error !== undefined ? (
                <Section>
                  <Text modifiers={[foregroundStyle("#FF3B30")]}>{error}</Text>
                </Section>
              ) : null}
            </Form>

            {/* Primary CTA — outside Form so it is not an inset well. */}
            <VStack spacing={8} modifiers={[padding({ horizontal: 16 })]}>
              <Button
                label={primaryLabel}
                onPress={submit}
                modifiers={[
                  buttonStyle("borderedProminent"),
                  controlSize("large"),
                  disabled(busy || probing),
                  frame({ maxWidth: Infinity }),
                ]}
              />
              {busy ? <ProgressView /> : null}
            </VStack>
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
