import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMarkdownImageUpload } from './useMarkdownImageUpload';

vi.mock('../../api/moduleAssetApi', () => ({
  moduleAssetApi: {
    requestUploadUrl: vi.fn(),
  },
}));

import { moduleAssetApi } from '../../api/moduleAssetApi';

beforeEach(() => {
  vi.clearAllMocks();
  // global fetch mock
  vi.stubGlobal('fetch', vi.fn());
});

function makeFile(name: string, type: string, sizeBytes: number): File {
  const blob = new Blob([new ArrayBuffer(sizeBytes)], { type });
  return new File([blob], name, { type });
}

describe('useMarkdownImageUpload', () => {
  it('rejects files larger than 5 MB without calling the API', async () => {
    const { result } = renderHook(() => useMarkdownImageUpload());
    const big = makeFile('big.png', 'image/png', 6 * 1024 * 1024);

    await act(async () => {
      await expect(result.current.upload(big)).rejects.toThrow(/too large/i);
    });
    expect(moduleAssetApi.requestUploadUrl).not.toHaveBeenCalled();
  });

  it('rejects unsupported file types without calling the API', async () => {
    const { result } = renderHook(() => useMarkdownImageUpload());
    const bad = makeFile('doc.pdf', 'application/pdf', 1024);

    await act(async () => {
      await expect(result.current.upload(bad)).rejects.toThrow(/unsupported/i);
    });
    expect(moduleAssetApi.requestUploadUrl).not.toHaveBeenCalled();
  });

  it('happy path: presign then PUT then return publicUrl + alt', async () => {
    vi.mocked(moduleAssetApi.requestUploadUrl).mockResolvedValue({
      uploadUrl: 'https://put.example/x',
      publicUrl: 'https://cdn.example/abc.png',
      key: 'module-assets/sub/202605/abc.png',
      expiresIn: 300,
    });
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200 } as Response);

    const { result } = renderHook(() => useMarkdownImageUpload());
    const file = makeFile('myPhoto.png', 'image/png', 2048);

    let out;
    await act(async () => {
      out = await result.current.upload(file);
    });
    expect(moduleAssetApi.requestUploadUrl).toHaveBeenCalledWith('image/png', 2048);
    expect(fetch).toHaveBeenCalledWith(
      'https://put.example/x',
      expect.objectContaining({
        method: 'PUT',
        body: file,
      })
    );
    expect(out).toEqual({
      publicUrl: 'https://cdn.example/abc.png',
      alt: 'myPhoto',
    });
  });

  it('throws when PUT fails', async () => {
    vi.mocked(moduleAssetApi.requestUploadUrl).mockResolvedValue({
      uploadUrl: 'https://put.example/x',
      publicUrl: 'https://cdn.example/abc.png',
      key: 'k',
      expiresIn: 300,
    });
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as Response);

    const { result } = renderHook(() => useMarkdownImageUpload());
    const file = makeFile('a.png', 'image/png', 2048);

    await act(async () => {
      await expect(result.current.upload(file)).rejects.toThrow(/upload failed/i);
    });
  });
});
