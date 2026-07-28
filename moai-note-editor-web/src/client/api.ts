/**
 * moai-note-api 클라이언트 (I §1).
 *
 * 토큰 만료(401)를 만나면 onTokenExpired 훅으로 새 토큰을 받아 **같은 요청을 재시도**한다.
 * 편집 중 토큰이 만료됐다고 사용자의 입력이 사라져서는 안 된다.
 */

export interface DocumentDto {
  id: string;
  title: string;
  content: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  currentRevision?: number;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly currentRevision: number | undefined;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.currentRevision = body.currentRevision;
  }

  get isConflict(): boolean {
    return this.code === 'REVISION_CONFLICT';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  token: string;
  onTokenExpired?: () => Promise<string>;
}

export class ApiClient {
  private readonly baseUrl: string;
  private token: string;
  private readonly onTokenExpired: (() => Promise<string>) | undefined;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.onTokenExpired = options.onTokenExpired;
  }

  setToken(token: string): void {
    this.token = token;
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    allowRetry = true,
  ): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
        ...(init.headers ?? {}),
      },
    });

    // 토큰 만료 — 새 토큰을 받아 한 번만 재시도한다(무한 루프 방지).
    if (res.status === 401 && allowRetry && this.onTokenExpired) {
      this.token = await this.onTokenExpired();
      return this.request<T>(path, init, false);
    }

    if (res.status === 204) return undefined as T;

    if (!res.ok) {
      let body: ApiErrorBody = { code: 'INTERNAL_ERROR', message: res.statusText };
      try {
        const parsed = (await res.json()) as { error?: ApiErrorBody };
        if (parsed.error) body = parsed.error;
      } catch {
        // 본문이 JSON이 아니면 기본 메시지를 쓴다
      }
      throw new ApiError(res.status, body);
    }

    return (await res.json()) as T;
  }

  getDocument(id: string): Promise<DocumentDto> {
    return this.request<DocumentDto>(`/api/v1/documents/${encodeURIComponent(id)}`);
  }

  updateDocument(
    id: string,
    input: { title: string; content: string; baseRevision: number },
  ): Promise<DocumentDto> {
    return this.request<DocumentDto>(`/api/v1/documents/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  }

  createDocument(input: { title: string; content: string }): Promise<DocumentDto> {
    return this.request<DocumentDto>('/api/v1/documents', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
}
