import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Center,
  Group,
  Modal,
  Paper,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from '@mantine/core';
import {
  IconArchive,
  IconCloudUpload,
  IconExternalLink,
  IconInbox,
  IconRefresh,
  IconUpload,
} from '@tabler/icons-react';
import { unityBuildApi, type UnityBuild } from '../../api/unityBuildApi';

const STATUS_COLORS: Record<UnityBuild['status'], string> = {
  uploaded: 'yellow',
  published: 'teal',
  archived: 'red',
  failed: 'orange',
};

function LoadingSkeleton() {
  return (
    <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="lg">
      {Array.from({ length: 4 }).map((_, index) => (
        <Paper key={index} radius="lg" withBorder p="lg">
          <Skeleton height={20} width="50%" mb="md" />
          <Skeleton height={14} width="35%" mb="sm" />
          <Skeleton height={14} width="80%" mb="sm" />
          <Skeleton height={14} width="60%" mb="md" />
          <Group justify="space-between">
            <Skeleton height={32} width={100} />
            <Skeleton circle height={32} />
          </Group>
        </Paper>
      ))}
    </SimpleGrid>
  );
}

function EmptyState() {
  return (
    <Center style={{ minHeight: 320 }}>
      <Stack align="center" gap="lg">
        <ThemeIcon size={88} radius="xl" variant="light" color="violet">
          <IconInbox size={40} />
        </ThemeIcon>
        <Box ta="center">
          <Title order={4} mb={4}>No Unity builds yet</Title>
          <Text c="dimmed" size="sm" maw={340}>
            Upload a Unity WebGL zip and publish it to S3 so scenes can launch a managed build instead of a local folder.
          </Text>
        </Box>
      </Stack>
    </Center>
  );
}

export default function UnityBuildsPage() {
  const [unityBuilds, setUnityBuilds] = useState<UnityBuild[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [buildKey, setBuildKey] = useState('');
  const [entryHtml, setEntryHtml] = useState('index.html');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [workingBuildId, setWorkingBuildId] = useState<string | null>(null);
  const replaceBuildIdRef = useRef<string | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);

  const sortedBuilds = useMemo(
    () =>
      [...unityBuilds].sort((a, b) => {
        const aTime = new Date(a.updatedAt).getTime();
        const bTime = new Date(b.updatedAt).getTime();
        return bTime - aTime;
      }),
    [unityBuilds]
  );

  const loadBuilds = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await unityBuildApi.list();
      setUnityBuilds(data.unityBuilds || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Unity builds');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadBuilds();
  }, []);

  const resetCreateForm = () => {
    setDisplayName('');
    setBuildKey('');
    setEntryHtml('index.html');
    setSelectedFile(null);
  };

  const uploadFileToS3 = async (
    uploadUrl: string,
    file: File,
    contentType: string,
    bucketName?: string | null
  ) => {
    let uploadHost = '';
    const currentOrigin = window.location.origin;
    try {
      const parsedUploadUrl = new URL(uploadUrl);
      uploadHost = parsedUploadUrl.host;
      if (parsedUploadUrl.hostname.includes('undefined')) {
        throw new Error(
          'Upload URL points to an invalid storage host. Redeploy the backend so the managed storage configuration is refreshed.'
        );
      }
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Backend returned an invalid upload URL.');
    }

    let response: Response;
    try {
      response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': contentType,
        },
        body: file,
      });
    } catch (error) {
      if (error instanceof TypeError) {
        const bucketMessage = bucketName ? ` Bucket: ${bucketName}.` : '';
        const hostMessage = uploadHost ? ` Host: ${uploadHost}.` : '';
        throw new Error(
          `Browser upload to S3 was blocked before the file was sent.${bucketMessage}${hostMessage} Make sure the S3 bucket CORS policy allows ${currentOrigin} for PUT preflight (OPTIONS) requests with the Content-Type header.`
        );
      }
      throw error;
    }

    if (!response.ok) {
      throw new Error(`Upload failed with status ${response.status}`);
    }
  };

  const handleCreateBuild = async () => {
    if (!selectedFile) {
      setError('Please select a Unity WebGL zip file.');
      return;
    }

    setWorkingBuildId('creating');
    setError(null);
    try {
      const uploadResponse = await unityBuildApi.createUploadUrl({
        displayName,
        buildKey,
        fileName: selectedFile.name,
        contentType: selectedFile.type || 'application/zip',
        entryHtml,
      });

      await uploadFileToS3(
        uploadResponse.uploadUrl,
        selectedFile,
        uploadResponse.uploadHeaders['Content-Type'],
        uploadResponse.uploadBucketName
      );
      await unityBuildApi.publish(uploadResponse.unityBuild.unityBuildId);
      setModalOpen(false);
      resetCreateForm();
      await loadBuilds();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload Unity build');
    } finally {
      setWorkingBuildId(null);
    }
  };

  const triggerReplaceZip = (unityBuildId: string) => {
    replaceBuildIdRef.current = unityBuildId;
    replaceInputRef.current?.click();
  };

  const handleReplaceFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    const unityBuildId = replaceBuildIdRef.current;
    event.currentTarget.value = '';
    if (!file || !unityBuildId) return;

    setWorkingBuildId(unityBuildId);
    setError(null);
    try {
      const existing = unityBuilds.find((build) => build.unityBuildId === unityBuildId);
      const uploadResponse = await unityBuildApi.replaceUploadUrl(unityBuildId, {
        displayName: existing?.displayName,
        entryHtml: existing?.entryHtml,
        fileName: file.name,
        contentType: file.type || 'application/zip',
      });

      await uploadFileToS3(
        uploadResponse.uploadUrl,
        file,
        uploadResponse.uploadHeaders['Content-Type'],
        uploadResponse.uploadBucketName
      );
      await unityBuildApi.publish(unityBuildId);
      await loadBuilds();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to replace Unity build zip');
    } finally {
      setWorkingBuildId(null);
      replaceBuildIdRef.current = null;
    }
  };

  const handleArchive = async (unityBuildId: string) => {
    setWorkingBuildId(unityBuildId);
    setError(null);
    try {
      await unityBuildApi.archive(unityBuildId);
      await loadBuilds();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive Unity build');
    } finally {
      setWorkingBuildId(null);
    }
  };

  return (
    <Stack gap="xl">
      <input
        ref={replaceInputRef}
        type="file"
        accept=".zip,application/zip"
        style={{ display: 'none' }}
        onChange={(event) => void handleReplaceFileSelected(event)}
      />

      <Group justify="space-between" align="flex-start">
        <Box>
          <Group gap="sm" mb={4}>
            <ThemeIcon size={38} radius="xl" variant="gradient" gradient={{ from: 'violet', to: 'grape' }}>
              <IconCloudUpload size={20} color="white" />
            </ThemeIcon>
            <Title order={2} fw={700}>Unity Builds</Title>
          </Group>
          <Text c="dimmed" size="sm" ml={52}>
            Upload Unity WebGL zip files, publish them to S3, and attach published builds to scenes.
          </Text>
        </Box>

        <Button
          radius="xl"
          leftSection={<IconUpload size={16} />}
          variant="gradient"
          gradient={{ from: 'violet', to: 'grape' }}
          onClick={() => setModalOpen(true)}
        >
          Upload Build
        </Button>
      </Group>

      {error && (
        <Paper radius="md" p="sm" withBorder style={{ borderColor: '#fecaca', background: '#fff1f2' }}>
          <Text size="sm" c="red.7">{error}</Text>
        </Paper>
      )}

      {loading ? (
        <LoadingSkeleton />
      ) : sortedBuilds.length === 0 ? (
        <EmptyState />
      ) : (
        <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="lg">
          {sortedBuilds.map((unityBuild) => (
            <Paper key={unityBuild.unityBuildId} radius="lg" p="lg" withBorder style={{ border: '1px solid #edf0f5' }}>
              <Group justify="space-between" align="flex-start" mb="md">
                <Box style={{ flex: 1, minWidth: 0 }}>
                  <Group gap="xs" mb={4}>
                    <Text fw={700} size="md" lineClamp={1}>{unityBuild.displayName}</Text>
                    <Badge variant="light" color={STATUS_COLORS[unityBuild.status]} radius="xl" size="xs">
                      {unityBuild.status}
                    </Badge>
                  </Group>
                  <Badge variant="outline" radius="xl" size="xs" color="gray">
                    {unityBuild.buildKey}
                  </Badge>
                </Box>
                <Group gap={4}>
                  {unityBuild.launchUrl && (
                    <ActionIcon
                      component="a"
                      href={unityBuild.launchUrl}
                      target="_blank"
                      rel="noreferrer"
                      variant="light"
                      color="blue"
                      radius="xl"
                      size="sm"
                    >
                      <IconExternalLink size={14} />
                    </ActionIcon>
                  )}
                  <ActionIcon
                    variant="light"
                    color="violet"
                    radius="xl"
                    size="sm"
                    onClick={() => triggerReplaceZip(unityBuild.unityBuildId)}
                    loading={workingBuildId === unityBuild.unityBuildId}
                  >
                    <IconRefresh size={14} />
                  </ActionIcon>
                  <ActionIcon
                    variant="light"
                    color="red"
                    radius="xl"
                    size="sm"
                    onClick={() => void handleArchive(unityBuild.unityBuildId)}
                    loading={workingBuildId === unityBuild.unityBuildId}
                  >
                    <IconArchive size={14} />
                  </ActionIcon>
                </Group>
              </Group>

              <Stack gap="xs">
                <Text size="xs" c="dimmed">Source Zip: {unityBuild.sourceFileName}</Text>
                <Text size="xs" c="dimmed">Entry HTML: {unityBuild.entryHtml}</Text>
                <Text size="xs" c="dimmed">Updated: {new Date(unityBuild.updatedAt).toLocaleString()}</Text>
                {unityBuild.launchUrl ? (
                  <Text size="xs" c="dimmed" lineClamp={2}>Launch URL: {unityBuild.launchUrl}</Text>
                ) : (
                  <Text size="xs" c="orange.7">Publish this build before attaching it to a scene.</Text>
                )}
              </Stack>
            </Paper>
          ))}
        </SimpleGrid>
      )}

      <Modal
        opened={modalOpen}
        onClose={() => {
          setModalOpen(false);
          resetCreateForm();
        }}
        title="Upload Unity Build"
        centered
      >
        <Stack gap="md">
          <TextInput
            label="Display Name"
            value={displayName}
            onChange={(event) => setDisplayName(event.currentTarget.value)}
            placeholder="Broca Aphasia WebGL"
            required
          />
          <TextInput
            label="Build Key"
            value={buildKey}
            onChange={(event) => setBuildKey(event.currentTarget.value)}
            placeholder="broca-aphasia-webgl-v2"
            required
          />
          <TextInput
            label="Entry HTML"
            value={entryHtml}
            onChange={(event) => setEntryHtml(event.currentTarget.value)}
            placeholder="index.html"
          />
          <Button
            variant="light"
            onClick={() => document.getElementById('unity-build-upload-input')?.click()}
          >
            {selectedFile ? selectedFile.name : 'Choose Unity WebGL Zip'}
          </Button>
          <input
            id="unity-build-upload-input"
            type="file"
            accept=".zip,application/zip"
            style={{ display: 'none' }}
            onChange={(event) => setSelectedFile(event.currentTarget.files?.[0] ?? null)}
          />

          <Group justify="flex-end">
            <Button
              variant="subtle"
              color="gray"
              onClick={() => {
                setModalOpen(false);
                resetCreateForm();
              }}
            >
              Cancel
            </Button>
            <Button
              variant="gradient"
              gradient={{ from: 'violet', to: 'grape' }}
              onClick={() => void handleCreateBuild()}
              loading={workingBuildId === 'creating'}
            >
              Upload and Publish
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
