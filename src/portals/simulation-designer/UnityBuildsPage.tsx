import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Modal,
  Paper,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import {
  IconArchive,
  IconExternalLink,
  IconInbox,
  IconRefresh,
  IconUpload,
} from '@tabler/icons-react';
import { unityBuildApi, type UnityBuild } from '../../api/unityBuildApi';
import { PageHeader, EmptyState } from '../../components/design';

const STATUS_COLORS: Record<UnityBuild['status'], string> = {
  uploaded: 'parchment',
  published: 'terracotta',
  archived: 'parchment',
  failed: 'terracotta',
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
        headers: { 'Content-Type': contentType },
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

      <PageHeader
        title="Unity Builds"
        subtitle="Upload Unity WebGL zip files, publish them to S3, and attach published builds to scenes."
        actions={
          <Button
            radius="lg"
            color="terracotta"
            leftSection={<IconUpload size={16} />}
            onClick={() => setModalOpen(true)}
          >
            Upload Build
          </Button>
        }
      />

      {error && (
        <Paper radius="md" p="sm" style={{ borderColor: 'var(--claude-terracotta)', background: 'var(--claude-ivory)', border: '1px solid var(--claude-terracotta)' }}>
          <Text size="sm" c="var(--claude-terracotta)">{error}</Text>
        </Paper>
      )}

      {loading ? (
        <LoadingSkeleton />
      ) : sortedBuilds.length === 0 ? (
        <EmptyState
          icon={<IconInbox size={28} />}
          title="No Unity builds yet"
          description="Upload a Unity WebGL zip and publish it to S3 so scenes can launch a managed build instead of a local folder."
          ctaLabel="Upload Build"
          onCta={() => setModalOpen(true)}
        />
      ) : (
        <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="lg">
          {sortedBuilds.map((unityBuild) => (
            <Paper
              key={unityBuild.unityBuildId}
              radius="lg" p="lg"
              style={{
                background: 'var(--claude-ivory)',
                border: '1px solid var(--claude-border-cream)',
                boxShadow: 'var(--claude-shadow-whisper)',
              }}
            >
              <Group justify="space-between" align="flex-start" mb="md">
                <Box style={{ flex: 1, minWidth: 0 }}>
                  <Group gap="xs" mb={4}>
                    <Text fw={500} size="md" lineClamp={1} c="var(--claude-near-black)" style={{ fontFamily: 'Georgia, serif' }}>
                      {unityBuild.displayName}
                    </Text>
                    <Badge variant="light" color={STATUS_COLORS[unityBuild.status]} radius="xl" size="xs">
                      {unityBuild.status}
                    </Badge>
                  </Group>
                  <Badge variant="outline" radius="xl" size="xs" color="parchment">
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
                      color="terracotta"
                      radius="md"
                      size="sm"
                    >
                      <IconExternalLink size={14} />
                    </ActionIcon>
                  )}
                  <ActionIcon
                    variant="light"
                    color="terracotta"
                    radius="md"
                    size="sm"
                    onClick={() => triggerReplaceZip(unityBuild.unityBuildId)}
                    loading={workingBuildId === unityBuild.unityBuildId}
                  >
                    <IconRefresh size={14} />
                  </ActionIcon>
                  <ActionIcon
                    variant="light"
                    color="parchment"
                    radius="md"
                    size="sm"
                    onClick={() => void handleArchive(unityBuild.unityBuildId)}
                    loading={workingBuildId === unityBuild.unityBuildId}
                  >
                    <IconArchive size={14} />
                  </ActionIcon>
                </Group>
              </Group>

              <Stack gap="xs">
                <Text size="xs" c="var(--claude-olive)">Source Zip: {unityBuild.sourceFileName}</Text>
                <Text size="xs" c="var(--claude-olive)">Entry HTML: {unityBuild.entryHtml}</Text>
                <Text size="xs" c="var(--claude-olive)">Updated: {new Date(unityBuild.updatedAt).toLocaleString()}</Text>
                {unityBuild.launchUrl ? (
                  <Text size="xs" c="var(--claude-olive)" lineClamp={2}>Launch URL: {unityBuild.launchUrl}</Text>
                ) : (
                  <Text size="xs" c="var(--claude-terracotta)">Publish this build before attaching it to a scene.</Text>
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
        radius="lg"
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
            color="terracotta"
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
              color="parchment"
              onClick={() => {
                setModalOpen(false);
                resetCreateForm();
              }}
            >
              Cancel
            </Button>
            <Button
              color="terracotta"
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
