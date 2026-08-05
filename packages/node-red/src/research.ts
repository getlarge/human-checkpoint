import {
  type ApprovalExpectation,
  runAuthorizedResearch,
  type SigningRequestView,
} from '@human-checkpoint/core';

export interface ExaResult {
  title: string;
  url: string;
  text?: string;
  publishedDate?: string;
}

export async function invokeExaAfterAuthoritativeApproval(input: {
  request: SigningRequestView;
  expected: ApprovalExpectation & { checkpoint: 'research-authorization' };
  apiKey: string;
  fetch?: typeof globalThis.fetch;
}): Promise<ExaResult[]> {
  if (!input.apiKey) throw new Error('Exa API key is not configured');
  const fetchImpl = input.fetch ?? globalThis.fetch;
  return runAuthorizedResearch({
    request: input.request,
    expected: input.expected,
    async invoke(scope) {
      const response = await fetchImpl('https://api.exa.ai/search', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': input.apiKey,
        },
        body: JSON.stringify({
          query: (scope.queries as string[]).join(' OR '),
          numResults: scope.maxResults,
          includeDomains: scope.allowedDomains,
          contents: { text: { maxCharacters: 1200 } },
        }),
      });
      const body = (await response.json()) as {
        results?: ExaResult[];
        error?: string;
      };
      if (!response.ok || !Array.isArray(body.results)) {
        throw new Error(
          body.error ?? `Exa request failed with HTTP ${response.status}`,
        );
      }
      return body.results;
    },
  });
}
