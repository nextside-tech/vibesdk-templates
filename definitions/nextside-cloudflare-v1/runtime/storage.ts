export type StorageCapability = {
  appId: string;
  objectPrefix: string;
};

export type StorageObjectPutInput = {
  key: string;
  value: ArrayBuffer;
  contentType: string;
};

export interface StorageServiceBinding {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface StoragePort {
  capabilityFor(appId: string): StorageCapability;
  put(capability: StorageCapability, input: StorageObjectPutInput): Promise<void>;
}

const APP_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;

const normalizeAppId = (appId: string): string => {
  const normalized = appId.trim();
  if (!APP_ID_PATTERN.test(normalized)) {
    throw new Error('appId must match ^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$');
  }
  return normalized;
};

const normalizeKey = (key: string): string => {
  const normalized = key
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/');
  if (normalized.length === 0) {
    throw new Error('storage key must not be empty');
  }
  return normalized;
};

const missingStorageService = (): never => {
  throw new Error('Storage service binding STORAGE_SERVICE is not rendered for this environment');
};

export const createStorageCapability = (appId: string): StorageCapability => {
  const normalizedAppId = normalizeAppId(appId);
  return {
    appId: normalizedAppId,
    objectPrefix: `apps/${normalizedAppId}`,
  };
};

export const resolveScopedStorageKey = (capability: StorageCapability, key: string): string => {
  const normalizedKey = normalizeKey(key);
  return `${capability.objectPrefix}/${normalizedKey}`;
};

export const createStoragePort = (binding?: StorageServiceBinding): StoragePort => ({
  capabilityFor(appId: string): StorageCapability {
    return createStorageCapability(appId);
  },

  async put(capability: StorageCapability, input: StorageObjectPutInput): Promise<void> {
    const service = binding ?? missingStorageService();
    const normalizedKey = normalizeKey(input.key);
    const scopedKey = resolveScopedStorageKey(capability, normalizedKey);
    const response = await service.fetch(
      new Request(
        `https://storage.internal/v1/apps/${encodeURIComponent(capability.appId)}/objects/${encodeURIComponent(
          normalizedKey,
        )}`,
        {
          method: 'PUT',
          headers: {
            'content-type': input.contentType,
            'x-nextside-app-id': capability.appId,
            'x-nextside-storage-key': scopedKey,
          },
          body: input.value,
        },
      ),
    );
    if (!response.ok) {
      throw new Error(`Storage service rejected ${capability.appId}: ${response.status}`);
    }
  },
});
