import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  enrichRepos,
  extractRepoMetadata,
  fetchRepoMetadata,
} from "../src/enrich.js";
import { captureStderr } from "./helpers.js";

/** 记录调用并按 fullName 回放预设结果的假 GitHub API 客户端。 */
function fakeGithubClient(script) {
  const calls = [];
  const client = async (fullName) => {
    calls.push(fullName);
    const step = script[fullName];
    if (step instanceof Error) throw step;
    return step;
  };
  return { client, calls };
}

function okJsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => payload,
  };
}

describe("extractRepoMetadata", () => {
  it("extracts topics, SPDX license and owner avatar from a real-shape payload", () => {
    const metadata = extractRepoMetadata({
      topics: ["formatting", "text"],
      license: { key: "mit", name: "MIT License", spdx_id: "MIT" },
      owner: { avatar_url: "https://avatars.githubusercontent.com/u/1?v=4" },
    });

    assert.deepEqual(metadata, {
      topics: ["formatting", "text"],
      license: "MIT",
      ownerAvatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
    });
  });

  it("maps NOASSERTION and missing license to null", () => {
    assert.equal(
      extractRepoMetadata({ license: { spdx_id: "NOASSERTION" } }).license,
      null,
    );
    assert.equal(extractRepoMetadata({ license: null }).license, null);
    assert.equal(extractRepoMetadata({}).license, null);
  });

  it("tolerates missing topics, missing owner and empty topic strings", () => {
    const metadata = extractRepoMetadata({ topics: ["", "cli"], owner: {} });

    assert.deepEqual(metadata, {
      topics: ["cli"],
      license: null,
      ownerAvatarUrl: null,
    });
    assert.deepEqual(extractRepoMetadata(null).topics, []);
  });
});

describe("fetchRepoMetadata (default fetch-based client)", () => {
  const payload = {
    topics: ["web"],
    license: { spdx_id: "Apache-2.0" },
    owner: { avatar_url: "https://avatars.githubusercontent.com/u/2?v=4" },
  };

  it("requests the repo endpoint and sends the Bearer token when given", async () => {
    const requests = [];
    const fetch = async (url, init) => {
      requests.push({ url, headers: init.headers });
      return okJsonResponse(payload);
    };

    const metadata = await fetchRepoMetadata("acme/rocket", {
      fetch,
      token: "tok-123",
    });

    assert.deepEqual(metadata, {
      topics: ["web"],
      license: "Apache-2.0",
      ownerAvatarUrl: "https://avatars.githubusercontent.com/u/2?v=4",
    });
    assert.equal(requests.length, 1);
    assert.equal(
      requests[0].url,
      "https://api.github.com/repos/acme/rocket",
    );
    assert.equal(requests[0].headers.Authorization, "Bearer tok-123");
  });

  it("stays anonymous (no Authorization header) when token is empty", async () => {
    const headers = [];
    const fetch = async (url, init) => {
      headers.push(init.headers);
      return okJsonResponse(payload);
    };

    await fetchRepoMetadata("acme/rocket", { fetch, token: "" });

    assert.equal("Authorization" in headers[0], false);
  });

  it("falls back to the GITHUB_TOKEN environment variable", async () => {
    const previous = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "env-token";
    const headers = [];
    try {
      await fetchRepoMetadata("acme/rocket", {
        fetch: async (url, init) => {
          headers.push(init.headers);
          return okJsonResponse(payload);
        },
      });
    } finally {
      if (previous === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = previous;
    }

    assert.equal(headers[0].Authorization, "Bearer env-token");
  });

  it("throws on a 404 response so the per-repo failure can be contained", async () => {
    await assert.rejects(
      fetchRepoMetadata("ghost/missing", {
        fetch: async () => ({
          ok: false,
          status: 404,
          statusText: "Not Found",
          json: async () => ({}),
        }),
      }),
      /HTTP 404/,
    );
  });

  it("throws on network errors instead of crashing the caller", async () => {
    await assert.rejects(
      fetchRepoMetadata("acme/rocket", {
        fetch: async () => {
          throw new Error("getaddrinfo ENOTFOUND");
        },
      }),
      /ENOTFOUND/,
    );
  });
});

describe("enrichRepos", () => {
  // enrichRepos 就地修改仓库对象，因此每个用例都造新数据，避免相互污染。
  const makeRepos = () => [{ fullName: "acme/rocket" }, { fullName: "acme/anvil" }];

  it("populates topics, license and ownerAvatarUrl on success", async () => {
    const repos = makeRepos();
    const { client, calls } = fakeGithubClient({
      "acme/rocket": {
        topics: ["rust", "cli"],
        license: "MIT",
        ownerAvatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
      },
      "acme/anvil": {
        topics: [],
        license: null,
        ownerAvatarUrl: null,
      },
    });

    const enriched = await enrichRepos(repos, { client });

    assert.deepEqual(calls, ["acme/rocket", "acme/anvil"]);
    assert.deepEqual(enriched[0], {
      fullName: "acme/rocket",
      topics: ["rust", "cli"],
      license: "MIT",
      ownerAvatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
    });
    assert.deepEqual(enriched[1], {
      fullName: "acme/anvil",
      topics: [],
      license: null,
      ownerAvatarUrl: null,
    });
  });

  it("keeps a 404 repo unenriched while the rest still get metadata", async () => {
    const repos = makeRepos();
    const { client } = fakeGithubClient({
      "acme/rocket": {
        topics: ["rust"],
        license: "MIT",
        ownerAvatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
      },
      "acme/anvil": new Error(
        "GitHub API returned HTTP 404 Not Found for acme/anvil",
      ),
    });

    await captureStderr(() => enrichRepos(repos, { client }));

    assert.deepEqual(repos[0].topics, ["rust"]);
    assert.equal("topics" in repos[1], false);
    assert.equal("license" in repos[1], false);
    assert.equal("ownerAvatarUrl" in repos[1], false);
    assert.equal(repos[1].fullName, "acme/anvil");
  });

  it("never rejects when every repo is rate-limited (403) and warns to stderr", async () => {
    const repos = makeRepos();
    const { client } = fakeGithubClient({
      "acme/rocket": new Error(
        "GitHub API returned HTTP 403 Forbidden for acme/rocket",
      ),
      "acme/anvil": new Error(
        "GitHub API returned HTTP 403 Forbidden for acme/anvil",
      ),
    });

    const lines = await captureStderr(() => enrichRepos(repos, { client }));

    assert.equal("topics" in repos[0], false);
    assert.equal("topics" in repos[1], false);
    assert.equal(lines.length, 2);
    assert.match(lines[0], /acme\/rocket/);
    assert.match(lines[0], /403/);
  });

  it("contains a client that throws synchronously", async () => {
    const client = () => {
      throw new Error("sync boom");
    };

    const lines = await captureStderr(() =>
      enrichRepos([{ fullName: "acme/boom" }], { client }),
    );

    assert.equal(lines.length, 1);
    assert.match(lines[0], /sync boom/);
  });

  it("is a no-op for an empty repo list", async () => {
    let called = false;
    const result = await enrichRepos([], {
      client: async () => {
        called = true;
        return { topics: [], license: null, ownerAvatarUrl: null };
      },
    });

    assert.deepEqual(result, []);
    assert.equal(called, false);
  });
});
