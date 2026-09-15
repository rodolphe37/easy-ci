"""Mode démo : des dépôts et pipelines fictifs mais réalistes (GitHub, GitLab, Bitbucket), sans compte.

Les exécutions « live » avancent réellement dans le temps (étapes qui se terminent,
jobs qui démarrent), ce qui permet de tester l'interface temps réel. Relancer un
run en échec le fait repartir… et réussir.
"""

from __future__ import annotations

import hashlib
import threading
import time
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from typing import Any

from easy_ci import logs
from easy_ci.bitbucket.service import mark_commands
from easy_ci.errors import NotFoundError
from easy_ci.i18n import N_, tr
from easy_ci.providers import BITBUCKET, GITHUB, GITLAB, PROVIDER_INFO, build_scan, capabilities, empty_scan, repo_key
from easy_ci.state import NEUTRAL, run_state
from easy_ci.workflow_yaml import summarize

HOUR = 3600


def _iso(timestamp: float | None) -> str | None:
    if timestamp is None:
        return None
    return datetime.fromtimestamp(timestamp, UTC).isoformat().replace("+00:00", "Z")


def _sha(seed: str) -> str:
    return hashlib.sha1(seed.encode()).hexdigest()


# ---------------------------------------------------------------------------
# Modèle des pipelines simulés
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Step:
    name: str
    seconds: int
    output: tuple[str, ...] = ()
    command: str | None = None  # contenu du bloc « Run … » dans le log


@dataclass(frozen=True)
class Job:
    name: str
    steps: tuple[Step, ...]
    stage: int = 0
    runner: str = "ubuntu-latest"
    # Échec simulé : index de l'étape, conclusion et sortie affichée avant l'erreur.
    fail_step: int | None = None
    fail_conclusion: str = "failure"
    fail_output: tuple[str, ...] = ()
    fail_error: str = "Process completed with exit code 1."
    annotations: tuple[dict[str, Any], ...] = ()
    stage_name: str | None = None  # stage GitLab affiché dans l'interface
    allow_failure: bool = False  # GitLab : un échec autorisé ne bloque pas le pipeline


@dataclass
class DemoRun:
    id: int
    repo: str
    workflow_id: str
    workflow_name: str
    run_number: int
    event: str
    branch: str
    message: str
    actor: str
    start: float
    jobs: tuple[Job, ...]
    attempt: int = 1
    cancelled_at: float | None = None
    pace: float = 1.0  # facteur de durée des étapes : les exécutions passées ne durent pas toutes pareil
    sha_seed: str | None = None  # relance sur le même commit qu'une exécution précédente
    previous_attempts: list[dict[str, Any]] = field(default_factory=list)  # jobs des tentatives relancées


@dataclass
class DemoWorkflow:
    id: str
    repo: str
    name: str
    path: str
    content: str
    make_jobs: Any  # Callable[[str], tuple[Job, ...]] — "success" | "failure" | "cancelled"
    history: str  # S = succès, F = échec, C = annulé (du plus ancien au plus récent)
    event: str = "push"
    runs: list[DemoRun] = field(default_factory=list)


# -- Étapes courantes -------------------------------------------------------

GREEN, RED, YELLOW, CYAN, DIM, BOLD, RESET = "\x1b[32m", "\x1b[31m", "\x1b[33m", "\x1b[36m", "\x1b[90m", "\x1b[1m", "\x1b[0m"


def checkout() -> Step:
    return Step(
        "Run actions/checkout@v4",
        3,
        (
            "Syncing repository: acme/app",
            "##[group]Getting Git version info",
            "git version 2.49.0",
            "##[endgroup]",
            "Temporarily overriding HOME='/home/runner/work/_temp' before making global git config changes",
            "[command]/usr/bin/git init /home/runner/work/app/app",
            "[command]/usr/bin/git -c protocol.version=2 fetch --no-tags --prune --no-recurse-submodules --depth=1 origin",
            "[command]/usr/bin/git checkout --progress --force -B main refs/remotes/origin/main",
        ),
        command="actions/checkout@v4",
    )


def setup(tool: str, version: str, seconds: int = 4) -> Step:
    return Step(
        f"Run actions/setup-{tool}@v5",
        seconds,
        (f"Found in cache @ /opt/hostedtoolcache/{tool}/{version}/x64", f"{tool} version: {version}", "Cache restored successfully"),
        command=f"actions/setup-{tool}@v5",
    )


def run(command: str, seconds: int, *output: str) -> Step:
    return Step(f"Run {command}", seconds, output, command=command)


NPM_CI = run(
    "npm ci",
    18,
    "npm warn deprecated inflight@1.0.6: This module is not supported, and leaks memory.",
    "",
    "added 1284 packages, and audited 1285 packages in 16s",
    "",
    "212 packages are looking for funding",
    f"found {GREEN}0{RESET} vulnerabilities",
)


def node_job(name: str, command: Step, stage: int = 0, **kwargs: Any) -> Job:
    return Job(name, (checkout(), setup("node", "22.18.0"), NPM_CI, command), stage=stage, **kwargs)


# ---------------------------------------------------------------------------
# Définition des dépôts et workflows de démo
# ---------------------------------------------------------------------------

REPOSITORIES: list[dict[str, Any]] = [
    {"full_name": "acme/storefront", "language": "TypeScript", "description": N_("Boutique en ligne Next.js"), "private": True, "pushed": 0.4},
    {"full_name": "acme/payments-api", "language": "Go", "description": N_("API de paiement et grand livre comptable"), "private": True, "pushed": 0.2},
    {"full_name": "acme/mobile-app", "language": "Kotlin", "description": N_("Application mobile Android & iOS"), "private": True, "pushed": 1},
    {"full_name": "acme/data-pipeline", "language": "Python", "description": N_("ETL et traitements planifiés"), "private": True, "pushed": 7},
    {"full_name": "acme/design-system", "language": "TypeScript", "description": N_("Bibliothèque de composants UI partagés"), "private": False, "pushed": 30},
    {"full_name": "acme/infrastructure", "language": "HCL", "description": N_("Terraform & manifests Kubernetes"), "private": True, "pushed": 2},
    {"full_name": "demo-user/dotfiles", "language": "Shell", "description": N_("Configuration personnelle"), "private": False, "pushed": 120},
    {"full_name": "acme/handbook", "language": None, "description": N_("Documentation interne de l'équipe"), "private": True, "pushed": 300},
    {"provider": GITLAB, "full_name": "platform/backend/billing-service", "language": None, "description": N_("Facturation et abonnements (FastAPI)"), "private": True, "pushed": 0.3},
    {"provider": GITLAB, "full_name": "platform/frontend/customer-portal", "language": None, "description": N_("Portail client Vue.js"), "private": True, "pushed": 0.8},
    {"provider": BITBUCKET, "full_name": "acme-team/marketing-site", "language": "javascript", "description": N_("Site vitrine Astro"), "private": False, "pushed": 1.5},
    {"provider": BITBUCKET, "full_name": "acme-team/data-importer", "language": "python", "description": N_("Import des catalogues fournisseurs"), "private": True, "pushed": 0.1},
]


def _storefront_ci(outcome: str) -> tuple[Job, ...]:
    tests_ok = run(
        "npm test -- --coverage",
        26,
        "",
        "> storefront@2.8.0 test",
        "> vitest run --coverage",
        "",
        f" {GREEN}✓{RESET} src/cart/cart.test.ts {DIM}(24 tests){RESET} 312ms",
        f" {GREEN}✓{RESET} src/checkout/pricing.test.ts {DIM}(18 tests){RESET} 208ms",
        f" {GREEN}✓{RESET} src/components/ProductCard.test.tsx {DIM}(9 tests){RESET} 544ms",
        "",
        f" {BOLD}Test Files{RESET}  {GREEN}3 passed{RESET} (3)",
        f"      {BOLD}Tests{RESET}  {GREEN}51 passed{RESET} (51)",
        f"   {BOLD}Duration{RESET}  4.21s",
    )
    test_job = node_job("Tests", tests_ok)
    if outcome == "failure":
        test_job = replace(
            test_job,
            fail_step=3,
            fail_output=(
                f" {GREEN}✓{RESET} src/cart/cart.test.ts {DIM}(24 tests){RESET} 318ms",
                f" {RED}❯{RESET} src/checkout/pricing.test.ts {DIM}(18 tests | {RED}1 failed{RESET}{DIM}){RESET} 231ms",
                f"   {RED}×{RESET} applies VAT after discount",
                "",
                f"{RED}⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯{RESET}",
                "",
                f"{RED}{BOLD} FAIL {RESET} src/checkout/pricing.test.ts > applies VAT after discount",
                f"{RED}AssertionError: expected 96 to be 95.99{RESET}",
                "",
                f"{CYAN} ❯ src/checkout/pricing.test.ts:42:31{RESET}",
                "     40|   const cart = makeCart([{ price: 100, qty: 1 }]);",
                "     41|   const total = computeTotal(cart, { discount: 0.2, vat: 0.2 });",
                "     42|   expect(total).toBe(95.99);",
                f"       |                 {RED}^{RESET}",
                "",
                f" {BOLD}Test Files{RESET}  {RED}1 failed{RESET} | {GREEN}2 passed{RESET} (3)",
                f"      {BOLD}Tests{RESET}  {RED}1 failed{RESET} | {GREEN}50 passed{RESET} (51)",
            ),
            annotations=(
                {"path": "src/checkout/pricing.test.ts", "start_line": 42, "end_line": 42, "level": "failure", "title": "applies VAT after discount", "message": "AssertionError: expected 96 to be 95.99"},
            ),
        )
    return (
        node_job("Lint", run("npm run lint", 9, "", "> eslint . --max-warnings=0", "", f"{GREEN}✔ No problems found{RESET}")),
        test_job,
        node_job("Build", run("npm run build", 34, "", "> next build", "", "   ▲ Next.js 15.4.2", "   Creating an optimized production build ...", f" {GREEN}✓{RESET} Compiled successfully in 21.4s", f" {GREEN}✓{RESET} Generating static pages (48/48)"), stage=1),
    )


def _storefront_deploy(outcome: str) -> tuple[Job, ...]:
    return (
        Job(
            "Build image",
            (
                checkout(),
                Step("Run docker/setup-buildx-action@v3", 4, ("Docker info", "Buildx version: v0.24.0"), command="docker/setup-buildx-action@v3"),
                run(
                    "docker build -t ghcr.io/acme/storefront:${{ github.sha }} .",
                    24,
                    "#1 [internal] load build definition from Dockerfile",
                    "#5 [deps 3/3] RUN npm ci --omit=dev",
                    f"#5 {GREEN}DONE 14.2s{RESET}",
                    "#9 [runner 4/4] COPY --from=builder /app/.next ./.next",
                    "#10 exporting to image",
                    f"#10 {GREEN}DONE 2.1s{RESET}",
                ),
                run("docker push ghcr.io/acme/storefront:${{ github.sha }}", 8, "The push refers to repository [ghcr.io/acme/storefront]", "latest: digest: sha256:4f1c…e21a size: 2417"),
            ),
        ),
        Job(
            "Deploy staging",
            (
                checkout(),
                Step("Run azure/setup-kubectl@v4", 3, ("kubectl v1.33.2 installed",), command="azure/setup-kubectl@v4"),
                run("kubectl set image deployment/storefront web=ghcr.io/acme/storefront:${{ github.sha }}", 5, "deployment.apps/storefront image updated"),
                run("kubectl rollout status deployment/storefront --timeout=5m", 22, "Waiting for deployment \"storefront\" rollout to finish: 1 of 3 updated replicas are available...", "Waiting for deployment \"storefront\" rollout to finish: 2 of 3 updated replicas are available...", f"deployment \"storefront\" {GREEN}successfully rolled out{RESET}"),
            ),
            stage=1,
        ),
        Job(
            "Smoke tests",
            (checkout(), run("npx playwright test --project=smoke", 28, "Running 12 tests using 4 workers", f"  {GREEN}12 passed{RESET} (24.8s)")),
            stage=2,
        ),
    )


def _storefront_codeql(outcome: str) -> tuple[Job, ...]:
    return (
        Job(
            "Analyze (javascript-typescript)",
            (
                checkout(),
                Step("Run github/codeql-action/init@v3", 12, ("Initializing CodeQL", "CodeQL bundle 2.22.1"), command="github/codeql-action/init@v3"),
                Step("Run github/codeql-action/analyze@v3", 95, ("Finalizing database", "Running queries", f"{GREEN}No new alerts{RESET}"), command="github/codeql-action/analyze@v3"),
            ),
        ),
    )


def _payments_ci(outcome: str) -> tuple[Job, ...]:
    go_test = run(
        "go test -race -cover ./...",
        38,
        "ok  \tgithub.com/acme/payments-api/internal/api\t2.184s\tcoverage: 81.2% of statements",
        "ok  \tgithub.com/acme/payments-api/internal/ledger\t1.402s\tcoverage: 88.9% of statements",
        "ok  \tgithub.com/acme/payments-api/internal/stripe\t0.903s\tcoverage: 74.0% of statements",
    )
    base = Job("Test", (checkout(), setup("go", "1.25.1"), run("go mod download", 6), go_test))
    if outcome == "failure":
        base = replace(
            base,
            fail_step=3,
            fail_output=(
                "ok  \tgithub.com/acme/payments-api/internal/api\t2.184s\tcoverage: 81.2% of statements",
                "=== RUN   TestLedger_Transfer",
                "=== RUN   TestLedger_Transfer/insufficient_funds",
                "=== RUN   TestLedger_Transfer/concurrent_transfers",
                "    ledger_test.go:87: ",
                "        \tError Trace:\t/home/runner/work/payments-api/internal/ledger/ledger_test.go:87",
                "        \tError:      \tNot equal: ",
                "        \t            \texpected: 1500",
                "        \t            \tactual  : 1450",
                "        \tTest:       \tTestLedger_Transfer/concurrent_transfers",
                f"{RED}--- FAIL: TestLedger_Transfer (0.03s){RESET}",
                f"    {RED}--- FAIL: TestLedger_Transfer/concurrent_transfers (0.02s){RESET}",
                f"{RED}FAIL{RESET}",
                f"{RED}FAIL\tgithub.com/acme/payments-api/internal/ledger\t1.517s{RESET}",
                "ok  \tgithub.com/acme/payments-api/internal/stripe\t0.903s\tcoverage: 74.0% of statements",
                f"{RED}FAIL{RESET}",
            ),
            annotations=(
                {"path": "internal/ledger/ledger_test.go", "start_line": 87, "end_line": 87, "level": "failure", "title": "TestLedger_Transfer/concurrent_transfers", "message": "Not equal: expected 1500, actual 1450"},
            ),
        )
    return (
        Job("Lint", (checkout(), setup("go", "1.25.1"), Step("Run golangci/golangci-lint-action@v8", 21, ("Running [golangci-lint run] in [/home/runner/work/payments-api] ...", f"{GREEN}0 issues.{RESET}"), command="golangci/golangci-lint-action@v8"))),
        base,
        Job("Build", (checkout(), setup("go", "1.25.1"), run("go build -o bin/api ./cmd/api", 17)), stage=1),
    )


def _payments_release(outcome: str) -> tuple[Job, ...]:
    return (
        Job("GoReleaser", (checkout(), setup("go", "1.25.1"), Step("Run goreleaser/goreleaser-action@v6", 64, ("• building binaries", "• publishing to GitHub release", f"{GREEN}• release succeeded after 58s{RESET}"), command="goreleaser/goreleaser-action@v6"))),
    )


def _android(outcome: str) -> tuple[Job, ...]:
    return (
        Job("Unit tests", (checkout(), setup("java", "21.0.8"), run("./gradlew testDebugUnitTest", 32, "> Task :app:testDebugUnitTest", f"{GREEN}BUILD SUCCESSFUL{RESET} in 31s", "142 actionable tasks: 142 executed"))),
        Job("Assemble release", (checkout(), setup("java", "21.0.8"), run("./gradlew assembleRelease", 41, "> Task :app:assembleRelease", f"{GREEN}BUILD SUCCESSFUL{RESET} in 40s")), stage=1),
    )


def _ios(outcome: str) -> tuple[Job, ...]:
    return (
        Job("Build iOS", (checkout(), run("xcodebuild -scheme App -destination 'platform=iOS Simulator,name=iPhone 16' build test", 88, f"{GREEN}** TEST SUCCEEDED **{RESET}")), runner="macos-15"),
    )


def _data_tests(outcome: str) -> tuple[Job, ...]:
    def pytest_job(version: str) -> Job:
        return Job(
            f"tests ({version})",
            (
                checkout(),
                setup("python", version),
                run("pip install -e '.[test]'", 14, "Successfully installed data-pipeline-1.4.0 pandas-2.3.2 pyarrow-21.0.0"),
                run("pytest -q", 22, f"{GREEN}........................................................{RESET} [ 87%]", f"{GREEN}........{RESET}                                                 [100%]", f"{GREEN}64 passed in 19.37s{RESET}"),
            ),
        )

    return (pytest_job("3.12"), pytest_job("3.13"))


def _nightly_etl(outcome: str) -> tuple[Job, ...]:
    job = Job(
        "run-etl",
        (checkout(), setup("python", "3.13"), run("python -m pipeline.nightly --date yesterday", 40, "INFO  Extracting orders (2025-09-13)…", "INFO  1 284 311 rows extracted", "INFO  Transforming…", "INFO  Loading into warehouse…")),
    )
    if outcome == "failure":
        job = replace(
            job,
            fail_step=2,
            fail_conclusion="timed_out",
            fail_output=(
                "INFO  Extracting orders (2025-09-13)…",
                "INFO  1 284 311 rows extracted",
                "INFO  Loading into warehouse…",
                f"{YELLOW}WARN  Warehouse lock held by session 4412, retrying in 60s (attempt 12/30){RESET}",
                f"{YELLOW}WARN  Warehouse lock held by session 4412, retrying in 60s (attempt 13/30){RESET}",
            ),
            fail_error="The job has exceeded the maximum execution time of 30m0s",
        )
    return (job,)


def _design_ci(outcome: str) -> tuple[Job, ...]:
    return (
        node_job("Test", run("npm test", 19, f" {GREEN}✓{RESET} 214 tests passed")),
        node_job("Storybook", run("npm run build-storybook", 37, f"{GREEN}info => Output directory: storybook-static{RESET}"), stage=1),
    )


def _design_publish(outcome: str) -> tuple[Job, ...]:
    job = node_job("Publish to npm", run("npm publish --provenance", 14, "npm notice 📦  @acme/design-system@4.2.0", "+ @acme/design-system@4.2.0"))
    if outcome == "cancelled":
        job = replace(job, fail_step=3, fail_conclusion="cancelled", fail_output=("npm notice 📦  @acme/design-system@4.2.0",), fail_error="The operation was canceled.")
    return (job,)


def _terraform(outcome: str) -> tuple[Job, ...]:
    return (
        Job(
            "Plan",
            (
                checkout(),
                Step("Run hashicorp/setup-terraform@v3", 4, ("Terraform v1.13.1",), command="hashicorp/setup-terraform@v3"),
                run("terraform init -input=false", 16, f"{GREEN}Terraform has been successfully initialized!{RESET}"),
                run("terraform plan -input=false -no-color", 45, "module.eks.aws_eks_cluster.this: Refreshing state...", f"Plan: {GREEN}2 to add{RESET}, {YELLOW}1 to change{RESET}, 0 to destroy."),
            ),
        ),
    )


_CI_YAML = """name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint

  test:
    name: Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test -- --coverage

  build:
    name: Build
    needs: [lint, test]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
"""

_DEPLOY_YAML = """name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  packages: write

jobs:
  image:
    name: Build image
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - run: docker build -t ghcr.io/acme/storefront:${{ github.sha }} .
      - run: docker push ghcr.io/acme/storefront:${{ github.sha }}

  staging:
    name: Deploy staging
    needs: image
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@v4
      - uses: azure/setup-kubectl@v4
      - run: kubectl set image deployment/storefront web=ghcr.io/acme/storefront:${{ github.sha }}
      - run: kubectl rollout status deployment/storefront --timeout=5m

  smoke:
    name: Smoke tests
    needs: staging
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx playwright test --project=smoke
"""

_CODEQL_YAML = """name: CodeQL

on:
  push:
    branches: [main]
  schedule:
    - cron: "24 3 * * 1"

jobs:
  analyze:
    name: Analyze (javascript-typescript)
    runs-on: ubuntu-latest
    permissions:
      security-events: write
    steps:
      - uses: actions/checkout@v4
      - uses: github/codeql-action/init@v3
        with:
          languages: javascript-typescript
      - uses: github/codeql-action/analyze@v3
"""

_GO_CI_YAML = """name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: "1.25"
      - uses: golangci/golangci-lint-action@v8

  test:
    name: Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: "1.25"
      - run: go mod download
      - run: go test -race -cover ./...

  build:
    name: Build
    needs: [lint, test]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: "1.25"
      - run: go build -o bin/api ./cmd/api
"""

_RELEASE_YAML = """name: Release

on:
  push:
    tags: ["v*"]

permissions:
  contents: write

jobs:
  goreleaser:
    name: GoReleaser
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-go@v5
        with:
          go-version: "1.25"
      - uses: goreleaser/goreleaser-action@v6
        with:
          args: release --clean
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
"""

_ANDROID_YAML = """name: Android build

on:
  pull_request:
  push:
    branches: [main]

jobs:
  unit-tests:
    name: Unit tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v5
        with:
          distribution: temurin
          java-version: 21
      - run: ./gradlew testDebugUnitTest

  assemble:
    name: Assemble release
    needs: unit-tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v5
        with:
          distribution: temurin
          java-version: 21
      - run: ./gradlew assembleRelease
"""

_IOS_YAML = """name: iOS build

on:
  push:
    branches: [main]

jobs:
  build:
    name: Build iOS
    runs-on: macos-15
    steps:
      - uses: actions/checkout@v4
      - run: xcodebuild -scheme App -destination 'platform=iOS Simulator,name=iPhone 16' build test
"""

_PYTEST_YAML = """name: Tests

on:
  push:
  pull_request:

jobs:
  tests:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ["3.12", "3.13"]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python-version }}
      - run: pip install -e '.[test]'
      - run: pytest -q
"""

_ETL_YAML = """name: Nightly ETL

on:
  schedule:
    - cron: "0 2 * * *"
  workflow_dispatch:

jobs:
  run-etl:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.13"
      - run: python -m pipeline.nightly --date yesterday
        env:
          WAREHOUSE_URL: ${{ secrets.WAREHOUSE_URL }}
"""

_DESIGN_CI_YAML = """name: CI

on: [push, pull_request]

jobs:
  test:
    name: Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - run: npm ci
      - run: npm test

  storybook:
    name: Storybook
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - run: npm ci
      - run: npm run build-storybook
"""

_PUBLISH_YAML = """name: Publish

on:
  release:
    types: [published]

jobs:
  publish:
    name: Publish to npm
    runs-on: ubuntu-latest
    permissions:
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          registry-url: https://registry.npmjs.org
      - run: npm ci
      - run: npm publish --provenance
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
"""

_TERRAFORM_YAML = """name: Terraform plan

on:
  pull_request:
    paths: ["terraform/**"]
  push:
    branches: [main]

jobs:
  plan:
    name: Plan
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
      - run: terraform init -input=false
      - run: terraform plan -input=false -no-color
"""

# -- GitLab CI ---------------------------------------------------------------

GITLAB_RUNNER = "saas-linux-small-amd64"


def cmd(command: str, seconds: int, *output: str) -> Step:
    """Commande d'un script GitLab ou Bitbucket (affichée « $ commande » ou « + commande »)."""
    return Step(command, seconds, output, command=command)


def _billing_jobs(outcome: str) -> tuple[Job, ...]:
    tests = Job(
        "unit-tests",
        (
            cmd("pip install -r requirements-dev.txt", 12, "Collecting fastapi==0.116.1", "Successfully installed fastapi-0.116.1 pydantic-2.11.7 pytest-8.4.1"),
            cmd("pytest --junitxml=report.xml", 26, f"{GREEN}.......................................{RESET} [ 81%]", f"{GREEN}.........{RESET}                                  [100%]", f"{GREEN}48 passed in 21.02s{RESET}"),
        ),
        stage=1,
        runner=GITLAB_RUNNER,
        stage_name="test",
    )
    if outcome == "failure":
        tests = replace(
            tests,
            fail_step=1,
            fail_output=(
                f"{GREEN}.......................................{RESET}{RED}F{RESET}{GREEN}........{RESET} [100%]",
                "",
                f"{RED}{BOLD}FAILED{RESET} tests/test_invoices.py::test_prorata_on_downgrade",
                "    def test_prorata_on_downgrade():",
                "        invoice = compute_invoice(plan='pro', downgrade_to='starter', day=15)",
                f"{RED}>       assert invoice.total == Decimal('14.50'){RESET}",
                f"{RED}E       AssertionError: assert Decimal('14.49') == Decimal('14.50'){RESET}",
                "",
                f"{RED}1 failed{RESET}, {GREEN}47 passed{RESET} in 21.40s",
            ),
            fail_error="Job failed: exit code 1",
            annotations=(
                {"path": "tests/test_invoices.py", "start_line": None, "end_line": None, "level": "failure", "title": "tests.test_invoices › test_prorata_on_downgrade", "message": "AssertionError: assert Decimal('14.49') == Decimal('14.50')"},
            ),
        )
    return (
        Job("build-image", (cmd("docker build -t $CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA .", 22, "#8 [4/5] RUN pip install --no-cache-dir -r requirements.txt", f"#8 {GREEN}DONE 14.8s{RESET}", "#10 exporting to image"), cmd("docker push $CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA", 8, "latest: digest: sha256:9d2e…41bc size: 1788")), stage=0, runner=GITLAB_RUNNER, stage_name="build"),
        tests,
        Job(
            "lint",
            (cmd("ruff check .", 6, "src/billing/tax.py:41:5: E501 Line too long (104 > 100)", f"{YELLOW}Found 1 error.{RESET}"),),
            stage=1,
            runner=GITLAB_RUNNER,
            stage_name="test",
            fail_step=0,
            fail_output=("src/billing/tax.py:41:5: E501 Line too long (104 > 100)", f"{YELLOW}Found 1 error.{RESET}"),
            fail_error="Job failed: exit code 1",
            allow_failure=True,
        ),
        Job("deploy-staging", (cmd("helm upgrade --install billing ./chart --set image.tag=$CI_COMMIT_SHORT_SHA", 18, 'Release "billing" has been upgraded. Happy Helming!', "REVISION: 58"), cmd("kubectl rollout status deploy/billing -n staging", 14, f'deployment "billing" {GREEN}successfully rolled out{RESET}')), stage=2, runner=GITLAB_RUNNER, stage_name="deploy"),
    )


def _portal_jobs(outcome: str) -> tuple[Job, ...]:
    unit = Job(
        "unit-tests",
        (cmd("npm ci", 16, "added 912 packages in 15s"), cmd("npm run test:unit", 20, f" {GREEN}✓{RESET} src/components/InvoiceTable.spec.ts (12 tests)", f" {BOLD}Tests{RESET}  {GREEN}64 passed{RESET} (64)")),
        stage=0,
        runner=GITLAB_RUNNER,
        stage_name="test",
    )
    if outcome == "failure":
        unit = replace(
            unit,
            fail_step=1,
            fail_output=(
                f" {GREEN}✓{RESET} src/components/InvoiceTable.spec.ts (12 tests)",
                f" {RED}❯{RESET} src/stores/session.spec.ts (8 tests | {RED}1 failed{RESET})",
                f"   {RED}×{RESET} refreshes the token before expiry",
                f"{RED}AssertionError: expected \"spy\" to be called 1 times, but got 0 times{RESET}",
                f"{CYAN} ❯ src/stores/session.spec.ts:57:24{RESET}",
                f" {BOLD}Tests{RESET}  {RED}1 failed{RESET} | {GREEN}63 passed{RESET} (64)",
            ),
            fail_error="Job failed: exit code 1",
        )
    return (
        unit,
        Job("e2e", (cmd("npx playwright test", 34, "Running 22 tests using 4 workers", f"  {GREEN}22 passed{RESET} (31.2s)"),), stage=0, runner=GITLAB_RUNNER, stage_name="test"),
        Job("pages", (cmd("npm run build", 18, "vite v7.1.3 building for production...", f"{GREEN}✓ built in 9.81s{RESET}"),), stage=1, runner=GITLAB_RUNNER, stage_name="deploy"),
    )


_BILLING_YAML = """stages: [build, test, deploy]

workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH

variables:
  PYTHON_VERSION: "3.13"

build-image:
  stage: build
  image: docker:27
  services: [docker:27-dind]
  script:
    - docker build -t $CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA .
    - docker push $CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA

unit-tests:
  stage: test
  image: python:3.13
  needs: [build-image]
  script:
    - pip install -r requirements-dev.txt
    - pytest --junitxml=report.xml
  artifacts:
    reports:
      junit: report.xml

lint:
  stage: test
  image: python:3.13
  allow_failure: true
  script:
    - ruff check .

deploy-staging:
  stage: deploy
  image: alpine/helm:3.18
  environment: staging
  needs: [unit-tests]
  script:
    - helm upgrade --install billing ./chart --set image.tag=$CI_COMMIT_SHORT_SHA
    - kubectl rollout status deploy/billing -n staging
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
"""

_PORTAL_YAML = """include:
  - template: Jobs/SAST.gitlab-ci.yml

stages: [test, deploy]

default:
  image: node:22

unit-tests:
  stage: test
  script:
    - npm ci
    - npm run test:unit

e2e:
  stage: test
  image: mcr.microsoft.com/playwright:v1.55.0
  script:
    - npx playwright test

pages:
  stage: deploy
  script:
    - npm run build
  only: [main]
"""

# -- Bitbucket Pipelines ------------------------------------------------------


def _marketing_steps(outcome: str) -> tuple[Job, ...]:
    return (
        Job("Build", (cmd("npm ci", 14, "added 402 packages in 13s"), cmd("npm run build", 16, "astro v5.13.2 build", f"{GREEN}✓ Completed in 12.4s.{RESET}", "  48 page(s) built")), runner="node:22"),
        Job("Deploy to production", (cmd("pipe: atlassian/aws-s3-deploy:2.0.0", 11, "INFO: Uploading 312 files to s3://acme-marketing", f"{GREEN}✔ Deployment successful.{RESET}"),), stage=1, runner="atlassian/default-image:4"),
    )


def _importer_steps(outcome: str) -> tuple[Job, ...]:
    tests = Job(
        "Tests",
        (
            cmd("pip install -r requirements.txt", 12, "Successfully installed pandas-2.3.2 requests-2.32.5"),
            cmd("python -m pytest -q", 24, f"{GREEN}.................................{RESET} [100%]", f"{GREEN}33 passed in 18.20s{RESET}"),
        ),
        runner="python:3.13",
    )
    if outcome == "failure":
        tests = replace(
            tests,
            fail_step=1,
            fail_output=(
                f"{GREEN}...........................{RESET}{RED}F{RESET}{GREEN}.....{RESET} [100%]",
                "=================================== FAILURES ===================================",
                "_________________________ test_parse_supplier_csv_encoding _____________________",
                "    rows = parse_catalog('fixtures/fournisseur-latin1.csv')",
                f"{RED}E   UnicodeDecodeError: 'utf-8' codec can't decode byte 0xe9 in position 1042{RESET}",
                f"{RED}FAILED tests/test_catalog.py::test_parse_supplier_csv_encoding{RESET}",
                f"{RED}1 failed{RESET}, {GREEN}32 passed{RESET} in 18.91s",
            ),
            fail_error="",
        )
    return (tests, Job("Import staging", (cmd("python -m importer --env staging", 20, "INFO  3 catalogs imported (18,402 products)"),), stage=1, runner="python:3.13"))


_MARKETING_YAML = """image: node:22

pipelines:
  default:
    - step:
        name: Build
        caches: [node]
        script:
          - npm ci
          - npm run build
  branches:
    main:
      - step:
          name: Build
          script:
            - npm ci
            - npm run build
          artifacts: [dist/**]
      - step:
          name: Deploy to production
          deployment: production
          script:
            - pipe: atlassian/aws-s3-deploy:2.0.0
              variables:
                S3_BUCKET: acme-marketing
                LOCAL_PATH: dist
"""

_IMPORTER_YAML = """image: python:3.13

definitions:
  steps:
    - step: &tests
        name: Tests
        caches: [pip]
        script:
          - pip install -r requirements.txt
          - python -m pytest -q

pipelines:
  pull-requests:
    "**":
      - step: *tests
  branches:
    main:
      - step: *tests
      - step:
          name: Import staging
          deployment: staging
          script:
            - python -m importer --env staging
  custom:
    import-production:
      - step:
          name: Import production
          trigger: manual
          script:
            - python -m importer --env production
"""

# (dépôt, nom, fichier, contenu, jobs, historique, événement, dernier run)
# Dernier run : ("static", "success" | "failure" | "cancelled", il y a N minutes)
#            ou ("live", issue, départ relatif au lancement de l'app en secondes)
_WORKFLOWS: list[tuple[Any, ...]] = [
    ("acme/storefront", "CI", "ci.yml", _CI_YAML, _storefront_ci, "SSSSFSSSSSS", "push", ("static", "success", 25)),
    ("acme/storefront", "Deploy", "deploy.yml", _DEPLOY_YAML, _storefront_deploy, "SSSSSSSSSSS", "push", ("live", "success", -25)),
    ("acme/storefront", "CodeQL", "codeql.yml", _CODEQL_YAML, _storefront_codeql, "SSSSSSSSSSS", "schedule", ("static", "success", 380)),
    ("acme/payments-api", "CI", "ci.yml", _GO_CI_YAML, _payments_ci, "SSSSSSSSFSS", "push", ("static", "failure", 12)),
    ("acme/payments-api", "Release", "release.yml", _RELEASE_YAML, _payments_release, "SSSSSS", "push", ("static", "success", 2900)),
    ("acme/mobile-app", "Android build", "android.yml", _ANDROID_YAML, _android, "SSSFFSSSSSS", "pull_request", ("live", "success", 12)),
    ("acme/mobile-app", "iOS build", "ios.yml", _IOS_YAML, _ios, "SSSSSSSSSSS", "push", ("static", "success", 95)),
    ("acme/data-pipeline", "Tests", "tests.yml", _PYTEST_YAML, _data_tests, "SSSSSSSSSSS", "push", ("static", "success", 420)),
    ("acme/data-pipeline", "Nightly ETL", "nightly-etl.yml", _ETL_YAML, _nightly_etl, "SSSSSSSSFSS", "schedule", ("static", "failure", 440)),
    ("acme/design-system", "CI", "ci.yml", _DESIGN_CI_YAML, _design_ci, "SSSSSSSSSSS", "push", ("static", "success", 1800)),
    ("acme/design-system", "Publish", "publish.yml", _PUBLISH_YAML, _design_publish, "SSSSS", "release", ("static", "cancelled", 1750)),
    ("acme/infrastructure", "Terraform plan", "terraform.yml", _TERRAFORM_YAML, _terraform, "SSSSSSSSSSS", "push", ("live", "success", -60)),
    ("platform/backend/billing-service", "Pipeline", ".gitlab-ci.yml", _BILLING_YAML, _billing_jobs, "SSSFSSSSSSS", "push", ("live", "success", -40)),
    ("platform/frontend/customer-portal", "Pipeline", ".gitlab-ci.yml", _PORTAL_YAML, _portal_jobs, "SSSSSSSSSS", "merge_request", ("static", "failure", 35)),
    ("acme-team/marketing-site", "Pipelines", "bitbucket-pipelines.yml", _MARKETING_YAML, _marketing_steps, "SSSSSSSSSSS", "push", ("static", "success", 70)),
    ("acme-team/data-importer", "Pipelines", "bitbucket-pipelines.yml", _IMPORTER_YAML, _importer_steps, "SSSSSSSSS", "pull_request", ("live", "failure", -15)),
]

# Workflows dont un job échoue parfois puis passe à la relance (statistiques : jobs instables).
_FLAKY_WORKFLOWS = {("acme/storefront", "CI"), ("platform/backend/billing-service", "Pipeline")}
# Ralentissement par exécution (en part de la durée actuelle) : tendance visible dans les statistiques.
_DURATION_TRENDS = {("acme/storefront", "CI"): 0.035, ("acme/payments-api", "CI"): -0.02}

_MESSAGES = [
    N_("fix(checkout): arrondi de la TVA sur les remises"),
    N_("feat: ajout du paiement en trois fois"),
    "chore(deps): bump vite from 7.0.6 to 7.1.3",
    N_("refactor: extraction du service de panier"),
    N_("feat(api): pagination des transactions"),
    N_("fix: timeout du webhook Stripe"),
    N_("docs: mise à jour du guide de contribution"),
    N_("perf: cache des fiches produits"),
    N_("ci: activation du cache npm"),
    N_("feat: nouveau tunnel de commande"),
]
_ACTORS = ["marie-dupont", "thomas-martin", "dependabot[bot]", "demo-user", "lea-bernard"]
_BRANCHES = ["main", "main", "feat/paiement-3x", "main", "fix/tva-remises", "main"]


# ---------------------------------------------------------------------------
# Service de démo
# ---------------------------------------------------------------------------


class DemoService:
    provider = "demo"

    def __init__(self, now: float | None = None) -> None:
        self._started = now if now is not None else time.time()
        self._lock = threading.Lock()
        self._repos = {r["full_name"]: self._make_repo(i, r) for i, r in enumerate(REPOSITORIES)}
        self._workflows: dict[str, list[DemoWorkflow]] = {}
        self._runs: dict[int, DemoRun] = {}
        self._next_run_id = 17_000_000_000
        self._pull_requests: dict[tuple[str, str], dict[str, Any]] = {}
        self._build_runs()

    def close(self) -> None:
        pass

    # -- Construction -----------------------------------------------------

    def _make_repo(self, index: int, raw: dict[str, Any]) -> dict[str, Any]:
        provider = raw.get("provider", GITHUB)
        full_name = raw["full_name"]
        owner, _, name = full_name.rpartition("/")
        host = PROVIDER_INFO[provider]["default_host"]
        return {
            "id": str(1000 + index),
            "provider": provider,
            "key": repo_key(provider, full_name),
            "full_name": full_name,
            "owner": owner,
            "name": name,
            "description": raw["description"],
            "private": raw["private"],
            "fork": False,
            "archived": False,
            "language": raw["language"],
            "default_branch": "main",
            "html_url": f"{host}/{full_name}",
            "pushed_at": _iso(self._started - raw["pushed"] * HOUR),
            "ci_config_path": {GITLAB: ".gitlab-ci.yml", BITBUCKET: "bitbucket-pipelines.yml"}.get(provider),
        }

    def _provider(self, full_name: str) -> str:
        return self._repos[full_name]["provider"]

    def _build_runs(self) -> None:
        for wf_index, (repo, name, filename, content, make_jobs, history, event, latest) in enumerate(_WORKFLOWS):
            provider = self._repos[repo]["provider"]
            workflow = DemoWorkflow(
                id={GITLAB: "gitlab-ci", BITBUCKET: "bitbucket-pipelines"}.get(provider, str(50_000 + wf_index)),
                repo=repo,
                name=name,
                path=filename if provider != GITHUB else f".github/workflows/{filename}",
                content=content,
                make_jobs=make_jobs,
                history=history,
                event=event,
            )
            self._workflows.setdefault(repo, []).append(workflow)

            trend = _DURATION_TRENDS.get((repo, name), 0.0)
            previous: DemoRun | None = None
            kind, outcome, offset = latest
            latest_start = self._started + offset if kind == "live" else self._started - offset * 60
            letters = history + {"success": "S", "failure": "F", "cancelled": "C"}[outcome]
            spacing = 5 * HOUR if event != "schedule" else 24 * HOUR
            previous_letter = ""
            for position, letter in enumerate(letters):
                age = len(letters) - 1 - position
                run_outcome = {"S": "success", "F": "failure", "C": "cancelled"}[letter]
                bot = {GITHUB: "github-actions[bot]", GITLAB: "project_bot", BITBUCKET: "Bitbucket Pipelines"}[provider]
                # Durées variables d'une exécution à l'autre, avec un ralentissement progressif pour certains workflows.
                jitter = 0.86 + ((wf_index * 7 + position * 13) % 29) / 100
                demo_run = DemoRun(
                    id=self._new_run_id(),
                    repo=repo,
                    workflow_id=workflow.id,
                    workflow_name=name,
                    run_number=120 + wf_index * 13 + position,
                    event=event,
                    branch="main" if event in ("schedule", "release") else _BRANCHES[(position + wf_index) % len(_BRANCHES)],
                    message=_MESSAGES[(position * 3 + wf_index) % len(_MESSAGES)],
                    actor=bot if event == "schedule" else _ACTORS[(position + wf_index) % len(_ACTORS)],
                    start=latest_start - age * spacing,
                    jobs=make_jobs(run_outcome),
                    pace=1.0 if age == 0 else max(0.5, jitter * (1 - trend * age)),
                )
                if previous is not None and (repo, name) in _FLAKY_WORKFLOWS and previous_letter == "F" and letter == "S":
                    # Test instable : relancé sans changement de code, il passe.
                    demo_run = replace(demo_run, sha_seed=previous.sha_seed or str(previous.id), message=previous.message, branch=previous.branch, event=previous.event)
                self._add_run(demo_run, workflow)
                previous, previous_letter = demo_run, letter

    def _new_run_id(self) -> int:
        self._next_run_id += 7
        return self._next_run_id

    def _add_run(self, demo_run: DemoRun, workflow: DemoWorkflow) -> None:
        workflow.runs.append(demo_run)
        self._runs[demo_run.id] = demo_run

    # -- Simulation temporelle ----------------------------------------------

    def _materialize(self, demo_run: DemoRun, now: float | None = None) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        now = time.time() if now is None else now
        if demo_run.cancelled_at is not None:
            now = min(now, demo_run.cancelled_at)
        cancelled = demo_run.cancelled_at is not None
        provider = self._provider(demo_run.repo)

        jobs: list[dict[str, Any]] = []
        stage_start = demo_run.start + 4  # délai de prise en charge par un runner
        blocked = False
        run_end = stage_start
        stages = sorted({job.stage for job in demo_run.jobs})

        for stage in stages:
            stage_end = stage_start
            stage_failed = False
            for index, job in enumerate(demo_run.jobs):
                if job.stage != stage:
                    continue
                job_id = demo_run.id * 1000 + demo_run.attempt * 100 + index
                if blocked:
                    # Un job d'une étape précédente a échoué : les suivants sont ignorés.
                    conclusion = "cancelled" if cancelled else "skipped"
                    jobs.append(self._job_dict(provider, demo_run, job, job_id, "completed", conclusion, None, None, []))
                    continue

                cursor = stage_start
                steps = []
                job_conclusion: str | None = "success"
                job_end = stage_start
                job_status = "completed"
                fail_end = stage_start + sum(_paced(s, demo_run) for s in job.steps[: job.fail_step + 1]) if job.fail_step is not None else None
                for step_index, step in enumerate(job.steps):
                    step_start, step_end = cursor, cursor + _paced(step, demo_run)
                    if job.fail_step is not None and step_index > job.fail_step:
                        done = fail_end is not None and now >= fail_end
                        steps.append(self._step_dict(step_index, step, "completed" if done else "queued", "skipped" if done else None, None, None))
                        continue
                    if now < step_start:
                        status, conclusion, started, completed = ("cancelled_pending" if cancelled else "queued"), None, None, None
                    elif now < step_end:
                        status, conclusion, started, completed = "in_progress", None, step_start, None
                    else:
                        failed_here = job.fail_step == step_index
                        status, conclusion = "completed", (job.fail_conclusion if failed_here else "success")
                        started, completed = step_start, step_end
                    if status == "cancelled_pending":
                        status, conclusion = "completed", "skipped"
                    if cancelled and status == "in_progress":
                        status, conclusion, completed = "completed", "cancelled", now
                    steps.append(self._step_dict(step_index, step, status, conclusion, started, completed))
                    cursor = step_end
                    job_end = step_end

                if cancelled and now < job_end:
                    started_at = stage_start if now >= stage_start else None
                    job_status, job_conclusion, completed_at = "completed", "cancelled", (now if started_at else None)
                    if started_at is None:
                        steps = []
                elif now < stage_start:
                    job_status, job_conclusion, started_at, completed_at = "queued", None, None, None
                    steps = []
                elif now < job_end:
                    job_status, job_conclusion, started_at, completed_at = "in_progress", None, stage_start, None
                else:
                    job_conclusion = job.fail_conclusion if job.fail_step is not None else "success"
                    started_at, completed_at = stage_start, job_end
                if job_conclusion in ("failure", "timed_out", "cancelled") and not job.allow_failure:
                    stage_failed = True
                stage_end = max(stage_end, job_end)
                jobs.append(self._job_dict(provider, demo_run, job, job_id, job_status, job_conclusion, started_at, completed_at, steps))

            if stage_failed:
                blocked = True
            stage_start = stage_end + 2
            run_end = max(run_end, stage_end)

        states = [j["status"] for j in jobs]
        if now < demo_run.start + 4 and not cancelled:
            status, conclusion = "queued", None
        elif any(s in ("in_progress", "queued") for s in states):
            status, conclusion = "in_progress", None
        else:
            status = "completed"
            conclusions = {j["conclusion"] for j in jobs if not j["allow_failure"]}
            if cancelled or "cancelled" in conclusions:
                conclusion = "cancelled"
            elif conclusions & {"failure", "timed_out"}:
                conclusion = "failure"
            else:
                conclusion = "success"

        completed_at = min(run_end, now) if status == "completed" else None
        host = PROVIDER_INFO[provider]["default_host"]
        html_url = {
            GITHUB: f"{host}/{demo_run.repo}/actions/runs/{demo_run.id}",
            GITLAB: f"{host}/{demo_run.repo}/-/pipelines/{demo_run.id}",
            BITBUCKET: f"{host}/{demo_run.repo}/pipelines/results/{demo_run.run_number}",
        }[provider]
        run = {
            "id": str(demo_run.id),
            "name": demo_run.workflow_name,
            "title": tr(demo_run.message),
            "commit_message": tr(demo_run.message),
            "workflow_id": demo_run.workflow_id,
            "run_number": demo_run.run_number,
            "run_attempt": demo_run.attempt,
            "event": demo_run.event,
            "status": status,
            "conclusion": conclusion,
            "state": run_state(status, conclusion),
            "branch": demo_run.branch,
            "head_sha": _sha(demo_run.sha_seed or f"{demo_run.id}"),
            "actor": {"login": demo_run.actor, "avatar_url": None},
            "created_at": _iso(demo_run.start),
            "started_at": _iso(demo_run.start),
            "updated_at": _iso(completed_at or now),
            "duration_s": int(completed_at - demo_run.start) if completed_at else None,
            "html_url": html_url,
            "repository": demo_run.repo,
        }
        return run, jobs

    @staticmethod
    def _step_dict(index: int, step: Step, status: str, conclusion: str | None, started: float | None, completed: float | None) -> dict[str, Any]:
        return {
            "number": index + 1,
            "name": step.name,
            "status": status,
            "conclusion": conclusion,
            "state": run_state(status, conclusion),
            "started_at": _iso(started),
            "completed_at": _iso(completed),
            "duration_s": int(completed - started) if started is not None and completed is not None else None,
        }

    @staticmethod
    def _job_dict(provider: str, demo_run: DemoRun, job: Job, job_id: int, status: str, conclusion: str | None, started: float | None, completed: float | None, steps: list[dict[str, Any]]) -> dict[str, Any]:
        host = PROVIDER_INFO[provider]["default_host"]
        state = run_state(status, conclusion)
        allowed_failure = job.allow_failure and state == "failure"
        return {
            "id": str(job_id),
            "name": job.name,
            "stage": job.stage_name,
            "allow_failure": allowed_failure,
            "status": status,
            "conclusion": conclusion,
            "state": NEUTRAL if allowed_failure else state,
            "started_at": _iso(started),
            "completed_at": _iso(completed),
            "duration_s": int(completed - started) if started is not None and completed is not None else None,
            "runner_name": {GITHUB: f"GitHub Actions {job_id % 97}", GITLAB: f"blue-{job_id % 9}.{GITLAB_RUNNER}", BITBUCKET: None}[provider] if started else None,
            "labels": [job.runner],
            "html_url": {
                GITHUB: f"{host}/{demo_run.repo}/actions/runs/{demo_run.id}/job/{job_id}",
                GITLAB: f"{host}/{demo_run.repo}/-/jobs/{job_id}",
                BITBUCKET: f"{host}/{demo_run.repo}/pipelines/results/{demo_run.run_number}/steps/{job_id}",
            }[provider],
            # Seul GitHub expose des étapes par job ; GitLab et Bitbucket structurent le log.
            "steps": steps if provider == GITHUB else [],
            "_steps": steps,
        }

    # -- API publique (mêmes signatures que les services réels) -----------------

    def get_user(self) -> dict[str, Any]:
        return {"login": "demo-user", "name": tr("Utilisateur démo"), "avatar_url": None, "html_url": None}

    def rate_limit(self) -> dict[str, int] | None:
        return None

    @staticmethod
    def _localized(repo: dict[str, Any]) -> dict[str, Any]:
        return {**repo, "description": tr(repo["description"])} if repo.get("description") else repo

    def list_repositories(self) -> list[dict[str, Any]]:
        return sorted((self._localized(repo) for repo in self._repos.values()), key=lambda r: r["pushed_at"] or "", reverse=True)

    def get_repository(self, full_name: str) -> dict[str, Any]:
        match = next((repo for name, repo in self._repos.items() if name.lower() == full_name.lower()), None)
        if match is None:
            raise NotFoundError(tr("Dépôt introuvable."))
        return self._localized(match)

    def scan_repository(self, full_name: str) -> dict[str, Any]:
        self.get_repository(full_name)
        workflows = self._workflows.get(full_name, [])
        if not workflows:
            return empty_scan(full_name)
        now = time.time()
        with self._lock:
            runs = [self._materialize(r, now)[0] for wf in workflows for r in wf.runs if r.start <= now]
        runs.sort(key=lambda r: r["created_at"], reverse=True)
        return build_scan(full_name, [self._workflow_dict(self._provider(full_name), wf) for wf in workflows], runs)

    def list_runs(self, full_name: str, workflow_id: str | None = None, branch: str | None = None, status: str | None = None, page: int = 1, per_page: int = 30) -> dict[str, Any]:
        now = time.time()
        with self._lock:
            candidates = [
                r for wf in self._workflows.get(full_name, []) for r in wf.runs
                if r.start <= now and (workflow_id is None or r.workflow_id == str(workflow_id)) and (branch is None or r.branch == branch)
            ]
            runs = [self._materialize(r, now)[0] for r in candidates]
        if status:
            runs = [r for r in runs if r["state"] == status]
        runs.sort(key=lambda r: r["created_at"], reverse=True)
        start = (page - 1) * per_page
        return {"runs": runs[start : start + per_page], "total_count": len(runs), "page": page, "has_more": start + per_page < len(runs)}

    def get_run(self, full_name: str, run_id: str) -> dict[str, Any]:
        demo_run = self._find_run(full_name, run_id)
        with self._lock:
            run, jobs = self._materialize(demo_run)
        return {
            "run": run,
            "jobs": [{k: v for k, v in job.items() if k != "_steps"} for job in jobs],
            "capabilities": capabilities(self._provider(full_name)),
        }

    def list_job_attempts(self, full_name: str, run_id: str) -> list[dict[str, Any]]:
        demo_run = self._find_run(full_name, run_id)
        with self._lock:
            _, jobs = self._materialize(demo_run)
            previous = list(demo_run.previous_attempts)
        return [*previous, *({**{k: v for k, v in job.items() if k != "_steps"}, "attempt": demo_run.attempt} for job in jobs)]

    def get_job_log(self, full_name: str, job_id: str) -> dict[str, Any]:
        numeric_id = int(job_id)
        demo_run = self._find_run(full_name, str(numeric_id // 1000))
        provider = self._provider(full_name)
        now = time.time()
        with self._lock:
            _, jobs = self._materialize(demo_run, now)
        job_data = next((j for j in jobs if j["id"] == str(numeric_id)), None)
        if job_data is None or not job_data["started_at"]:
            return {"available": False}
        complete = job_data["status"] == "completed"
        if provider == GITHUB and not complete:
            return {"available": False}  # comme sur GitHub : log publié à la fin du job
        job = demo_run.jobs[numeric_id % 100]
        failed = job_data["state"] == "failure" or job_data["allow_failure"]
        if provider == GITLAB:
            text = _render_gitlab_log(job, job_data, now)
        elif provider == BITBUCKET:
            text = mark_commands(_render_bitbucket_log(job, job_data, now))
        else:
            text = _render_log(job, job_data)
        parsed = logs.parse_log(text, failed=failed, collapse_groups=provider == GITHUB)
        return {"available": True, "complete": complete, **parsed}

    def get_job_annotations(self, full_name: str, job_id: str) -> list[dict[str, Any]]:
        numeric_id = int(job_id)
        demo_run = self._find_run(full_name, str(numeric_id // 1000))
        provider = self._provider(full_name)
        with self._lock:
            _, jobs = self._materialize(demo_run)
        job_data = next((j for j in jobs if j["id"] == str(numeric_id)), None)
        job = demo_run.jobs[numeric_id % 100]
        if not job_data or job_data["conclusion"] not in ("failure", "timed_out", "cancelled") or provider == BITBUCKET:
            return []
        if provider == GITLAB:
            level = "warning" if job.allow_failure else "failure"
            reason = tr("Le script du job s'est terminé en erreur (code de sortie non nul).")
            if job.allow_failure:
                reason += tr(" Échec autorisé : le pipeline continue.")
            return [*job.annotations, {"path": None, "start_line": None, "end_line": None, "level": level, "title": None, "message": reason}]
        level = "warning" if job_data["conclusion"] == "cancelled" else "failure"
        return [*job.annotations, {"path": ".github", "start_line": None, "end_line": None, "level": level, "title": None, "message": job.fail_error}]

    def rerun_run(self, full_name: str, run_id: str, failed_only: bool = False) -> dict[str, str]:
        demo_run = self._find_run(full_name, run_id)
        provider = self._provider(full_name)
        workflow = next(wf for wf in self._workflows[full_name] if wf.id == demo_run.workflow_id)
        with self._lock:
            if provider == GITHUB or failed_only:
                # Nouvelle tentative de la même exécution… qui réussit cette fois.
                _, jobs = self._materialize(demo_run)
                demo_run.previous_attempts.extend({**{k: v for k, v in job.items() if k != "_steps"}, "attempt": demo_run.attempt} for job in jobs)
                demo_run.attempt += 1
                demo_run.start = time.time() + 2
                demo_run.cancelled_at = None
                demo_run.jobs = workflow.make_jobs("success")
                return {"run_id": str(demo_run.id)}
            # GitLab / Bitbucket : un nouveau pipeline est créé sur la même branche.
            new_run = replace(
                demo_run,
                id=self._new_run_id(),
                run_number=max(r.run_number for r in workflow.runs) + 1,
                event="manual",
                actor="demo-user",
                start=time.time() + 2,
                attempt=1,
                cancelled_at=None,
                jobs=workflow.make_jobs("success"),
            )
            self._add_run(new_run, workflow)
            return {"run_id": str(new_run.id)}

    def cancel_run(self, full_name: str, run_id: str) -> None:
        demo_run = self._find_run(full_name, run_id)
        with self._lock:
            run, _ = self._materialize(demo_run)
            if run["status"] != "completed":
                demo_run.cancelled_at = time.time()

    def get_workflow_file(self, full_name: str, path: str, ref: str | None = None) -> dict[str, Any]:
        workflow = next((wf for wf in self._workflows.get(full_name, []) if wf.path == path), None)
        if workflow is None:
            raise NotFoundError("Fichier introuvable.")
        provider = self._provider(full_name)
        host = PROVIDER_INFO[provider]["default_host"]
        html_url = {GITHUB: f"{host}/{full_name}/blob/main/{path}", GITLAB: f"{host}/{full_name}/-/blob/main/{path}", BITBUCKET: f"{host}/{full_name}/src/main/{path}"}[provider]
        return {"path": path, "sha": _sha(workflow.content), "html_url": html_url, "content": workflow.content, "summary": summarize(provider, workflow.content)}

    # -- Pull requests & validation ---------------------------------------

    def find_pull_request(self, full_name: str, branch: str) -> dict[str, Any] | None:
        return self._pull_requests.get((full_name, branch))

    def create_pull_request(self, full_name: str, branch: str, base: str, title: str, body: str, draft: bool = False) -> dict[str, Any]:
        provider = self._provider(full_name)
        number = 40 + len(self._pull_requests) + 1
        host = PROVIDER_INFO[provider]["default_host"]
        url = {GITHUB: f"{host}/{full_name}/pull/{number}", GITLAB: f"{host}/{full_name}/-/merge_requests/{number}", BITBUCKET: f"{host}/{full_name}/pull-requests/{number}"}[provider]
        pull = {
            "number": number,
            "title": f"Draft: {title}" if draft and provider == GITLAB else title,
            "url": url,
            "state": "open",
            "draft": draft,
            "source_branch": branch,
            "target_branch": base,
            "label": "Merge request" if provider == GITLAB else "Pull request",
        }
        self._pull_requests[(full_name, branch)] = pull
        return pull

    def lint_ci(self, full_name: str, content: str, ref: str | None = None) -> dict[str, Any]:
        from easy_ci.validation import validate

        result = validate(self._provider(full_name), content)
        errors = [f"{p['message']} (ligne {p['line']})" if p["line"] else p["message"] for p in result["problems"] if p["severity"] == "error"]
        warnings = [p["message"] for p in result["problems"] if p["severity"] == "warning"]
        return {"valid": not errors, "errors": errors, "warnings": warnings}

    # -- Utilitaires ------------------------------------------------------

    def _find_run(self, full_name: str, run_id: str | int) -> DemoRun:
        try:
            demo_run = self._runs.get(int(run_id))
        except ValueError:
            demo_run = None
        if demo_run is None or demo_run.repo != full_name:
            raise NotFoundError(tr("Exécution introuvable."))
        return demo_run

    @staticmethod
    def _workflow_dict(provider: str, wf: DemoWorkflow) -> dict[str, Any]:
        host = PROVIDER_INFO[provider]["default_host"]
        html_url = {
            GITHUB: f"{host}/{wf.repo}/actions/workflows/{wf.path.rsplit('/', 1)[-1]}",
            GITLAB: f"{host}/{wf.repo}/-/pipelines",
            BITBUCKET: f"{host}/{wf.repo}/pipelines",
        }[provider]
        return {"id": wf.id, "name": wf.name, "path": wf.path, "state": "active", "html_url": html_url, "dynamic": False}


def _paced(step: Step, demo_run: DemoRun) -> int:
    return max(1, round(step.seconds * demo_run.pace))


def _progress(step: dict[str, Any], seconds: int, now: float) -> float:
    """Part de la sortie d'une étape déjà produite (1 si terminée)."""
    if step["completed_at"]:
        return 1.0
    if not step["started_at"]:
        return 0.0
    started = datetime.fromisoformat(step["started_at"].replace("Z", "+00:00")).timestamp()
    return max(0.0, min(1.0, (now - started) / max(1, seconds)))


def _render_gitlab_log(job: Job, job_data: dict[str, Any], now: float) -> str:
    """Log au format GitLab Runner, tronqué à ce qui a déjà été exécuté (logs en direct)."""
    t = int(now)
    lines = [
        "\x1b[0KRunning with gitlab-runner 18.3.0 (5b3a4f2e)\x1b[0;m",
        f"\x1b[0K  on {job_data['runner_name']} jxYsz9gh, system ID: s_6b1a2e9f\x1b[0;m",
        f"section_start:{t}:prepare_executor\r\x1b[0K\x1b[0K\x1b[36;1mPreparing the \"docker+machine\" executor\x1b[0;m",
        f"\x1b[0KUsing Docker executor with image {job.runner if ':' in job.runner else 'python:3.13'} ...\x1b[0;m",
        f"section_end:{t}:prepare_executor\r\x1b[0K",
        f"section_start:{t}:get_sources\r\x1b[0K\x1b[0K\x1b[36;1mGetting source from Git repository\x1b[0;m",
        "\x1b[32;1mFetching changes with git depth set to 20...\x1b[0;m",
        f"Checking out {_sha(job.name)[:8]} as detached HEAD (ref is main)...",
        f"section_end:{t}:get_sources\r\x1b[0K",
        f"section_start:{t}:step_script[collapsed=false]\r\x1b[0K\x1b[0K\x1b[36;1mExecuting \"step_script\" stage of the job script\x1b[0;m",
    ]
    failed = False
    for step, step_data in zip(job.steps, job_data["_steps"], strict=False):
        if not step_data["started_at"]:
            break
        lines.append(f"\x1b[32;1m$ {step.command}\x1b[0;m")
        failed_here = step_data["conclusion"] in ("failure", "timed_out")
        output = job.fail_output if failed_here else step.output
        lines += list(output[: max(0, round(len(output) * _progress(step_data, step.seconds, now)))])
        failed = failed or failed_here
        if not step_data["completed_at"]:
            return "\n".join(lines)
    lines.append(f"section_end:{t}:step_script\r\x1b[0K")
    if job_data["status"] == "completed":
        lines.append(f"section_start:{t}:cleanup_file_variables\r\x1b[0K\x1b[0K\x1b[36;1mCleaning up project directory and file based variables\x1b[0;m")
        lines.append(f"section_end:{t}:cleanup_file_variables\r\x1b[0K")
        lines.append("\x1b[31;1mERROR: Job failed: exit code 1\x1b[0;m" if failed else "\x1b[32;1mJob succeeded\x1b[0;m")
    return "\n".join(lines)


def _render_bitbucket_log(job: Job, job_data: dict[str, Any], now: float) -> str:
    """Log au format Bitbucket Pipelines : chaque commande est précédée de « + »."""
    lines = [
        "+ umask 000",
        '+ GIT_LFS_SKIP_SMUDGE=1 retry 6 git clone --branch="main" --depth 50 https://x-token-auth:$REPOSITORY_OAUTH_ACCESS_TOKEN@bitbucket.org/$BITBUCKET_REPO_FULL_NAME.git $BUILD_DIR',
        "Cloning into '/opt/atlassian/pipelines/agent/build'...",
        f"+ git reset --hard {_sha(job.name)[:12]}",
        f"HEAD is now at {_sha(job.name)[:7]} Merge branch 'main'",
    ]
    for step, step_data in zip(job.steps, job_data["_steps"], strict=False):
        if not step_data["started_at"]:
            break
        lines.append(f"+ {step.command}")
        failed_here = step_data["conclusion"] in ("failure", "timed_out")
        output = job.fail_output if failed_here else step.output
        lines += list(output[: max(0, round(len(output) * _progress(step_data, step.seconds, now)))])
        if not step_data["completed_at"] or failed_here:
            break
    return "\n".join(lines)


def _render_log(job: Job, job_data: dict[str, Any]) -> str:
    """Produit un log au format GitHub Actions (horodatage, groupes, marqueurs)."""
    lines: list[str] = []

    def ts(value: str | None) -> str:
        return value or job_data["started_at"]

    start_ts = ts(job_data["started_at"])
    lines += [
        f"{start_ts} Current runner version: '2.328.0'",
        f"{start_ts} ##[group]Runner Image Provisioner",
        f"{start_ts} Hosted Compute Agent",
        f"{start_ts} Version: 20250829.383",
        f"{start_ts} ##[endgroup]",
        f"{start_ts} ##[group]Operating System",
        f"{start_ts} {'macOS 15.6' if 'macos' in job.runner else 'Ubuntu 24.04.3 LTS'}",
        f"{start_ts} ##[endgroup]",
        f"{start_ts} ##[group]GITHUB_TOKEN Permissions",
        f"{start_ts} Contents: read",
        f"{start_ts} Metadata: read",
        f"{start_ts} ##[endgroup]",
        f"{start_ts} Secret source: Actions",
        f"{start_ts} Prepare workflow directory",
        f"{start_ts} Complete job name: {job.name}",
    ]
    for step, step_data in zip(job.steps, job_data["steps"], strict=False):
        if step_data["conclusion"] == "skipped" or not step_data["started_at"]:
            continue
        stamp = ts(step_data["started_at"])
        lines.append(f"{stamp} ##[group]{step.name}")
        if step.command and not step.command.startswith(("actions/", "docker/", "azure/", "github/", "golangci/", "goreleaser/", "hashicorp/")):
            lines += [f"{stamp} {step.command}", f"{stamp} shell: /usr/bin/bash -e {{0}}"]
        else:
            lines.append(f"{stamp} with:")
        lines.append(f"{stamp} ##[endgroup]")
        failed_here = step_data["conclusion"] in ("failure", "timed_out", "cancelled")
        end_stamp = ts(step_data["completed_at"])
        output = job.fail_output if failed_here else step.output
        lines += [f"{end_stamp} {line}" for line in output]
        if failed_here:
            lines.append(f"{end_stamp} ##[error]{job.fail_error}")
    end = ts(job_data["completed_at"])
    lines += [f"{end} Post job cleanup.", f"{end} Cleaning up orphan processes"]
    return "\n".join(lines)
