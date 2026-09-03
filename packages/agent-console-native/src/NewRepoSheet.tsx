/**
 * Native sheet for adding a repo — empty `git init` or clone under the
 * configured main-checkout template. Clone probes `git ls-remote` so the
 * user can confirm remote metadata and pick a branch before writing.
 *
 * Built with `@expo/ui` SwiftUI (`BottomSheet` + `Form` + `TextField` +
 * `Picker` + `List`) rather than RN `Modal` / `TextInput` chrome.
 *
 * @internal
 */
import * as React from "react";
import { StyleSheet } from "react-native";
import {
  BottomSheet,
  Button,
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
} from "@expo/ui/swift-ui";
import {
  autocorrectionDisabled,
  bold,
  disabled,
  foregroundStyle,
  keyboardType,
  listStyle,
  onSubmit,
  pickerStyle,
  presentationDetents,
  presentationDragIndicator,
  tag,
  textInputAutocapitalization,
} from "@expo/ui/swift-ui/modifiers";
import { useAppContext } from "./AppContext";
import {
  cloneRepo,
  initRepo,
  parseRemoteInput,
  previewRemote,
  searchGitHubRepos,
  type GitHubSearchHit,
  type RemotePreview,
} from "./repoCreate";

type Mode = "clone" | "create";

type Props = {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onCreated: (repoName: string, mainPath: string) => void;
};

const secondaryText = foregroundStyle({ type: "hierarchical", style: "secondary" });

export const NewRepoSheet = (props: Props): React.ReactElement => {
  const { client, rootDir } = useAppContext();
  const [mode, setMode] = React.useState<Mode>("clone");
  const searchState = useNativeState("");
  const urlState = useNativeState("");
  const nameState = useNativeState("");
  const [hits, setHits] = React.useState<ReadonlyArray<GitHubSearchHit>>([]);
  const [searching, setSearching] = React.useState(false);
  const [preview, setPreview] = React.useState<RemotePreview | undefined>(undefined);
  const [branch, setBranch] = React.useState<string | undefined>(undefined);
  const [probing, setProbing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    if (!props.visible) return;
    setMode("clone");
    searchState.set("");
    urlState.set("");
    nameState.set("");
    setHits([]);
    setPreview(undefined);
    setBranch(undefined);
    setError(undefined);
    setBusy(false);
    setProbing(false);
    setSearching(false);
    // Native states are stable refs; only reset when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.visible]);

  const runProbe = async (raw: string, nameOverride?: string): Promise<RemotePreview | undefined> => {
    setProbing(true);
    setError(undefined);
    try {
      const next = await previewRemote(client, rootDir, raw, nameOverride);
      setPreview(next);
      nameState.set(nameOverride?.trim() || next.remote.name);
      setBranch(next.defaultBranch);
      urlState.set(next.remote.url);
      return next;
    } catch (err) {
      setPreview(undefined);
      setError(err instanceof Error ? err.message : "Couldn't reach that remote.");
      return undefined;
    } finally {
      setProbing(false);
    }
  };

  const probeFromUrlField = (): void => {
    const raw = urlState.get().trim();
    if (parseRemoteInput(raw) === undefined) return;
    void runProbe(raw, nameState.get().trim() || undefined);
  };

  const onSearch = (): void => {
    const q = searchState.get().trim();
    if (q.length === 0) return;
    setSearching(true);
    setError(undefined);
    void searchGitHubRepos(client, rootDir, q)
      .then((results) => {
        setHits(results);
        if (results.length === 0) {
          setError("No GitHub results (is `gh` available and signed in on the OpenCode host?).");
        }
      })
      .catch((err: unknown) => {
        setHits([]);
        setError(err instanceof Error ? err.message : "Search failed.");
      })
      .finally(() => setSearching(false));
  };

  const submit = (): void => {
    const repoName = nameState.get().trim();
    if (repoName.length === 0) {
      setError("Give the repo a name.");
      return;
    }
    setBusy(true);
    setError(undefined);
    void (async () => {
      try {
        if (mode === "create") {
          const path = await initRepo(client, rootDir, repoName);
          props.onCreated(repoName, path);
          props.onClose();
          return;
        }
        let ready = preview;
        if (ready === undefined) {
          ready = await runProbe(urlState.get(), repoName);
          if (ready === undefined) return;
        }
        const path = await cloneRepo(client, rootDir, ready.remote.url, repoName, branch);
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

  const primaryLabel = busy
    ? "Working…"
    : mode === "create"
      ? "Create"
      : preview === undefined
        ? "Look up"
        : "Clone";

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
          <Form>
            <Section>
              <HStack>
                <Button label="Cancel" role="cancel" onPress={props.onClose} />
                <Spacer />
                <Text modifiers={[bold()]}>New repo</Text>
                <Spacer />
                <Button
                  label={primaryLabel}
                  onPress={submit}
                  modifiers={[disabled(busy || probing)]}
                />
              </HStack>
            </Section>

            <Section>
              <Picker
                selection={mode}
                onSelectionChange={(value) => {
                  if (value === "clone" || value === "create") {
                    setMode(value);
                    setError(undefined);
                  }
                }}
                modifiers={[pickerStyle("segmented")]}
              >
                <Text modifiers={[tag("clone")]}>Clone</Text>
                <Text modifiers={[tag("create")]}>Empty repo</Text>
              </Picker>
            </Section>

            {mode === "clone" ? (
              <>
                <Section
                  title="GitHub search"
                  footer={
                    <Text modifiers={[secondaryText]}>Find repos by name, then confirm the remote below.</Text>
                  }
                >
                  <TextField
                    text={searchState}
                    placeholder="owner/repo or keywords"
                    modifiers={[
                      autocorrectionDisabled(),
                      textInputAutocapitalization("never"),
                      onSubmit(onSearch),
                    ]}
                  />
                  <Button
                    label={searching ? "Searching…" : "Search"}
                    systemImage="magnifyingglass"
                    onPress={onSearch}
                    modifiers={[disabled(searching)]}
                  />
                </Section>

                {hits.length > 0 ? (
                  <Section title="Results">
                    <List modifiers={[listStyle("plain")]}>
                      {hits.map((hit) => (
                        <Button
                          key={hit.fullName}
                          label={hit.fullName}
                          onPress={() => {
                            const short = hit.fullName.split("/")[1] ?? hit.fullName;
                            urlState.set(hit.url);
                            nameState.set(short);
                            void runProbe(hit.url, short);
                          }}
                        />
                      ))}
                    </List>
                  </Section>
                ) : null}

                <Section
                  title="Clone URL"
                  footer={
                    <Text modifiers={[secondaryText]}>Paste a URL, SSH remote, or owner/repo.</Text>
                  }
                >
                  <TextField
                    text={urlState}
                    placeholder="https://github.com/org/repo.git"
                    onFocusChange={(focused) => {
                      if (!focused) probeFromUrlField();
                    }}
                    modifiers={[
                      keyboardType("url"),
                      autocorrectionDisabled(),
                      textInputAutocapitalization("never"),
                      onSubmit(probeFromUrlField),
                    ]}
                  />
                  {probing ? <ProgressView /> : null}
                </Section>

                {preview !== undefined ? (
                  <Section title="Remote">
                    <LabeledContent label="Repo">
                      <Text>
                        {preview.remote.host !== undefined ? `${preview.remote.host}/` : ""}
                        {preview.remote.owner !== undefined ? `${preview.remote.owner}/` : ""}
                        {preview.remote.name}
                      </Text>
                    </LabeledContent>
                    <LabeledContent label="URL">
                      <Text modifiers={[secondaryText]}>{preview.remote.url}</Text>
                    </LabeledContent>
                    {destinationPreview !== undefined ? (
                      <LabeledContent label="Destination">
                        <Text modifiers={[secondaryText]}>{destinationPreview}</Text>
                      </LabeledContent>
                    ) : null}
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
                  </Section>
                ) : null}
              </>
            ) : null}

            <Section
              title="Local name"
              footer={
                <Text modifiers={[secondaryText]}>
                  Folder name used in the path template under your root.
                </Text>
              }
            >
              <TextField
                text={nameState}
                placeholder="my-project"
                modifiers={[
                  autocorrectionDisabled(),
                  textInputAutocapitalization("never"),
                  onSubmit(submit),
                ]}
              />
            </Section>

            {error !== undefined ? (
              <Section>
                <Text modifiers={[foregroundStyle("#FF3B30")]}>{error}</Text>
              </Section>
            ) : null}

            {busy ? (
              <Section>
                <ProgressView />
              </Section>
            ) : null}
          </Form>
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
