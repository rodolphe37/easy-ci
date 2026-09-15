// Built-in documentation — English version. Keep the same sections and ids as sections.fr.tsx.
import {
  Activity,
  Bell,
  BookOpen,
  ChartColumn,
  CircleArrowUp,
  CircleHelp,
  ExternalLink,
  FolderGit2,
  Gauge,
  GitBranch,
  KeyRound,
  FilePlus2,
  Keyboard,
  Laptop,
  Pencil,
  LayoutDashboard,
  RotateCcw,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  Workflow,
  Zap,
} from "lucide-react";
import { CI_FILE_STATES, ciStateInfo, CiStateBadge } from "@/components/local/LocalProjectPanel";
import { stateLabel, StatusIcon } from "@/components/status";
import { Kbd } from "@/components/ui/primitives";
import type { ProviderId, RunStateName } from "@/lib/types";
import { Callout, Code, CodeBlock, ExternalButton, H3, P, Question, Steps, Strong, Table, type DocSection } from "./primitives";

const CLASSIC_TOKEN_URL = "https://github.com/settings/tokens/new?scopes=repo,workflow,read:org&description=Easy%20CI";
const FINE_GRAINED_URL = "https://github.com/settings/personal-access-tokens/new";

function GitHubGuide() {
  return (
    <>
      <P>
        Easy CI reads your repositories and pipelines through GitHub's official API. To do so, the app needs a <Strong>personal access token</Strong>: a key you
        create on GitHub, which you can restrict and revoke at any time. There are three ways to connect.
      </P>

      <H3>Option 1: classic token (recommended)</H3>
      <P>The simplest: a single token gives access to your personal repositories and to those of all your organizations.</P>
      <Steps>
        <>
          On Easy CI's sign-in screen, <Strong>GitHub</Strong> tab, click <Strong>"Create one on GitHub"</Strong>, or open{" "}
          <ExternalButton href={CLASSIC_TOKEN_URL}>the token creation page</ExternalButton> directly. The required scopes are already selected.
          <div className="mt-1 text-[12.5px] text-fg-subtle">
            Manual path: GitHub avatar › Settings › Developer settings › Personal access tokens › Tokens (classic) › Generate new token (classic).
          </div>
        </>
        <>
          Give it a recognizable name (<Code>Easy CI</Code>) and choose an <Strong>expiration date</Strong> (90 days is a good trade-off).
        </>
        <>
          Check the selected <i>scopes</i>:
          <Table
            head={["Scope", "What Easy CI uses it for"]}
            rows={[
              [<Code>repo</Code>, "Read your private repositories, their workflows, runs and logs; re-run and cancel runs."],
              [<Code>workflow</Code>, "Modify workflow files (pipeline editing and generation)."],
              [<Code>read:org</Code>, "List the repositories of the organizations you belong to."],
            ]}
          />
        </>
        <>
          Click <Strong>Generate token</Strong> and copy the value (it starts with <Code>ghp_</Code>). GitHub only shows it once.
        </>
        <>
          Back in Easy CI, paste the token into the <Strong>Personal access token</Strong> field and click <Strong>Sign in to GitHub</Strong>. Your repositories
          show up within seconds.
        </>
      </Steps>

      <Callout variant="warning" title="Organization with single sign-on (SSO)">
        If your company uses SAML SSO, the token must be authorized for the organization: in{" "}
        <ExternalButton href="https://github.com/settings/tokens">your token list</ExternalButton>, click <Strong>Configure SSO</Strong> next to the token, then{" "}
        <Strong>Authorize</Strong>. Without this step, the organization's repositories don't appear.
      </Callout>

      <H3>Option 2: fine-grained token</H3>
      <P>
        More restrictive: you pick exactly which repositories and permissions. In return, a token only covers a single owner (your account <i>or</i> one
        organization).
      </P>
      <Steps>
        <>
          Open <ExternalButton href={FINE_GRAINED_URL}>fine-grained token creation</ExternalButton> (Settings › Developer settings › Personal access tokens ›
          Fine-grained tokens).
        </>
        <>
          Choose the <Strong>Resource owner</Strong> (you or the organization), then <Strong>All repositories</Strong> or <Strong>Only select repositories</Strong>.
        </>
        <>
          Under <Strong>Repository permissions</Strong>, grant:
          <Table
            head={["Permission", "Level", "Purpose"]}
            rows={[
              ["Metadata", "Read-only", "Required: list repositories."],
              ["Actions", "Read and write", "See runs and logs, re-run, cancel. \"Read-only\" is enough to browse."],
              ["Contents", "Read-only", "Read YAML workflow files."],
              ["Checks", "Read-only", "Show error annotations (file and line at fault)."],
              ["Pull requests", "Read and write", "Create a pull request after changing the CI (optional)."],
            ]}
          />
        </>
        <>Generate the token (it starts with <Code>github_pat_</Code>), copy it and paste it into Easy CI.</>
      </Steps>
      <Callout variant="info">Some organizations require an administrator to approve fine-grained tokens before they work.</Callout>

      <H3>Option 3: reuse GitHub CLI</H3>
      <P>
        If the <Code>gh</Code> command-line tool is installed and signed in, the <Strong>"Use the GitHub CLI session"</Strong> button appears on the sign-in screen: no
        token to copy.
      </P>
      <CodeBlock>gh auth login</CodeBlock>
      <P>To be able to modify workflows later, add the matching scope:</P>
      <CodeBlock>gh auth refresh -s workflow</CodeBlock>

      <Callout variant="security" title="Where is my token stored?">
        In your system's secure keychain (macOS Keychain, Windows Credential Manager, Secret Service on Linux). It is only ever sent to <Code>api.github.com</Code>,
        never to an Easy CI server. You can also provide it through the <Code>EASY_CI_GITHUB_TOKEN</Code> environment variable.
      </Callout>
    </>
  );
}

function GitLabGuide() {
  return (
    <>
      <P>
        Easy CI works with <Strong>gitlab.com</Strong> and with <Strong>self-managed GitLab instances</Strong> (version 15 or later). Signing in uses a{" "}
        <Strong>personal access token</Strong>.
      </P>
      <Steps>
        <>
          In Easy CI, choose the <Strong>GitLab</Strong> tab. For a company instance, replace <Code>https://gitlab.com</Code> with its address (for example{" "}
          <Code>gitlab.mycompany.com</Code>).
        </>
        <>
          Click <Strong>"Create one on GitLab"</Strong>: the creation page opens on the right instance with the name and scopes prefilled.
          <div className="mt-1 text-[12.5px] text-fg-subtle">Manual path: avatar › Preferences (or Edit profile) › Access tokens › Add new token.</div>
        </>
        <>
          Choose an expiration date and check the <i>scopes</i>:
          <Table
            head={["Scope", "What Easy CI uses it for"]}
            rows={[
              [<Code>api</Code>, "Read projects, pipelines, jobs and logs; re-run and cancel pipelines; merge requests from the editor."],
              [<Code>read_api</Code>, "Read-only alternative: everything is visible, but re-run and cancel are refused."],
              [<Code>read_user</Code>, "Show your name and avatar."],
            ]}
          />
        </>
        <>
          Click <Strong>Create personal access token</Strong>, copy the value (it starts with <Code>glpat-</Code>) and paste it into Easy CI.
        </>
      </Steps>
      <Callout variant="info" title="Which projects show up?">
        Every project you are a <Strong>member</Strong> of, directly or through a group (subgroups included). The full path is kept:{" "}
        <Code>group/subgroup/project</Code>.
      </Callout>
      <Callout variant="warning" title="Self-managed instance with an internal certificate">
        If your GitLab uses a certificate issued by an internal authority, add it to the system certificate store; otherwise the connection fails with a network
        error.
      </Callout>
      <P>
        Equivalent environment variables: <Code>EASY_CI_GITLAB_TOKEN</Code> and <Code>EASY_CI_GITLAB_URL</Code>.
      </P>
    </>
  );
}

function BitbucketGuide() {
  return (
    <>
      <P>
        Easy CI supports <Strong>Bitbucket Cloud</Strong> (bitbucket.org). Atlassian replaced "app passwords" with <Strong>API tokens</Strong>: this is the
        recommended method.
      </P>

      <H3>Option 1: personal API token (recommended)</H3>
      <Steps>
        <>
          Open <ExternalButton href="https://id.atlassian.com/manage-profile/security/api-tokens">Atlassian API token management</ExternalButton> (Easy CI's "Create
          one on Bitbucket" link also leads there).
        </>
        <>
          Click <Strong>Create API token with scopes</Strong>, name it <Code>Easy CI</Code>, choose an expiration, then the <Strong>Bitbucket</Strong> app.
        </>
        <>
          Select the following scopes:
          <Table
            head={["Scope", "Purpose"]}
            rows={[
              [<Code>read:user:bitbucket</Code>, "Show your name and avatar."],
              [<Code>read:workspace:bitbucket</Code>, "Browse your workspaces."],
              [<Code>read:repository:bitbucket</Code>, "List repositories and read bitbucket-pipelines.yml."],
              [<Code>read:pipeline:bitbucket</Code>, "See pipelines, steps and logs."],
              [<Code>write:pipeline:bitbucket</Code>, "Re-run and stop pipelines (optional)."],
              [<Code>write:pullrequest:bitbucket</Code>, "Create pull requests from the editor (optional)."],
            ]}
          />
        </>
        <>
          Copy the token. In Easy CI, <Strong>Bitbucket</Strong> tab › <Strong>Personal API token</Strong>: enter your <Strong>Atlassian account email</Strong> (not
          your username) and paste the token.
        </>
      </Steps>

      <H3>Option 2: workspace or repository access token</H3>
      <P>
        Handy for a technical account: in Bitbucket, <Strong>Workspace settings</Strong> (or <Strong>Repository settings</Strong>) › <Strong>Access tokens</Strong> ›
        Create access token, with <i>Repositories: Read</i> and <i>Pipelines: Read</i> (or <i>Write</i> to re-run). In Easy CI, choose <Strong>Access token</Strong>{" "}
        and paste it.
      </P>
      <Callout variant="info">
        An access token isn't tied to any user: if your repositories don't appear automatically, add them with <Strong>Add a repository</Strong> (
        <Code>workspace/repository</Code>).
      </Callout>

      <H3>Bitbucket Pipelines specifics</H3>
      <ul className="my-3 ml-5 list-disc space-y-1 text-[13.5px] leading-relaxed text-fg-muted marker:text-fg-subtle">
        <li>Each pipeline "step" appears as a job; its commands (<Code>+ …</Code> lines) form the log sections.</li>
        <li>
          <Strong>Re-run</Strong> creates a new pipeline on the same branch: Bitbucket's API can't replay only the failed steps.
        </li>
        <li>Bitbucket doesn't provide annotations: Easy CI extracts the error from the last lines of the log.</li>
      </ul>
      <P>
        Environment variables: <Code>EASY_CI_BITBUCKET_EMAIL</Code> + <Code>EASY_CI_BITBUCKET_API_TOKEN</Code>, or <Code>EASY_CI_BITBUCKET_ACCESS_TOKEN</Code>.
      </P>
    </>
  );
}

export function ProviderGuide({ provider }: { provider: ProviderId }) {
  if (provider === "gitlab") return <GitLabGuide />;
  if (provider === "bitbucket") return <BitbucketGuide />;
  return <GitHubGuide />;
}

function AccountsGuide() {
  return (
    <>
      <P>
        Easy CI can follow <Strong>GitHub, GitLab and Bitbucket at the same time</Strong>, with one account per platform. All repositories appear in the same lists,
        identified by their platform's logo.
      </P>
      <Steps>
        <>On first launch, connect the platform of your choice from the welcome screen (details for each one are in the following sections).</>
        <>
          To add another one: <Strong>Settings › Accounts</Strong> › <Strong>Connect</Strong> button on the platform's row.
        </>
        <>
          To remove an account: <Strong>Disconnect</Strong> on its row. Its credentials are deleted from the keychain; the other accounts stay active.
        </>
      </Steps>
      <Callout variant="info" title="Expired credentials">
        If a platform rejects your credentials (expired or revoked token), only that account is disconnected and a message says so in Settings › Accounts. The other
        platforms keep working.
      </Callout>
      <H3>Without an account: demo mode</H3>
      <P>
        <Strong>"Explore demo mode"</Strong> loads fictitious repositories on all three platforms, some of whose pipelines run in real time. To switch to your real
        accounts, click <Strong>Connect an account</Strong> at the top of the screen.
      </P>
      <Table
        head={["", "GitHub Actions", "GitLab CI/CD", "Bitbucket Pipelines"]}
        rows={[
          ["Configuration file", <Code>.github/workflows/*.yml</Code>, <Code>.gitlab-ci.yml</Code>, <Code>bitbucket-pipelines.yml</Code>],
          ["Logs while running", "Live steps, log at the end of the job", "Live log", "Live log"],
          ["Re-run failed jobs", "Yes", "Yes", "No (new pipeline)"],
          ["Error annotations", "Yes", "JUnit test reports", "No (log excerpt)"],
          ["Self-managed instances", "No", "Yes", "No (Cloud only)"],
        ]}
      />
    </>
  );
}

const STATES: RunStateName[] = ["success", "failure", "running", "queued", "cancelled", "skipped", "action_required", "none"];
const STATE_HELP: Record<string, string> = {
  success: "All jobs finished without error.",
  failure: "At least one job failed or exceeded its timeout.",
  running: "The run is in progress; steps update live.",
  queued: "Waiting for an available runner or for a job it depends on.",
  cancelled: "Stopped manually or superseded by a more recent run.",
  skipped: "Not run, often because a previous job failed.",
  action_required: "Approval is required on GitHub (protected environment, external contributor…).",
  none: "The repository contains no CI configuration.",
};

export const DOC_SECTIONS: DocSection[] = [
  {
    id: "start",
    title: "Getting started",
    icon: BookOpen,
    summary: "What Easy CI does and how to use it in three steps.",
    content: (
      <>
        <P>
          Easy CI brings the CI/CD pipelines of all your repositories into a single app. No more opening every repository on GitHub: you see at a glance what passes,
          what's running and what's broken, and you understand why.
        </P>
        <Steps>
          <>
            <Strong>Connect GitHub, GitLab or Bitbucket</Strong> with a token (see the following sections), or explore demo mode first.
          </>
          <>
            <Strong>Your repositories are detected automatically</Strong> with their pipelines. Add or hide repositories if needed.
          </>
          <>
            <Strong>Follow and act</Strong>: live runs, error summary, readable logs, one-click re-run or cancel.
          </>
        </Steps>
        <Callout variant="tip" title="Tip">
          Press <Kbd>⌘</Kbd> <Kbd>K</Kbd> (or <Kbd>Ctrl</Kbd> <Kbd>K</Kbd>) anywhere to search for a repository or run an action.
        </Callout>
      </>
    ),
  },
  { id: "accounts", title: "Accounts and platforms", icon: Users, summary: "Connect several platforms, demo mode, comparison.", content: <AccountsGuide /> },
  { id: "connect", title: "Connect GitHub", icon: GitBranch, summary: "Create a token, required scopes, SSO, GitHub CLI.", content: <GitHubGuide /> },
  { id: "gitlab", title: "Connect GitLab", icon: KeyRound, summary: "gitlab.com or self-managed, token and scopes.", content: <GitLabGuide /> },
  { id: "bitbucket", title: "Connect Bitbucket", icon: KeyRound, summary: "Atlassian API token or access token.", content: <BitbucketGuide /> },
  {
    id: "repositories",
    title: "Add and manage repositories",
    icon: FolderGit2,
    summary: "Automatic discovery, manual addition, hiding and favorites.",
    content: (
      <>
        <H3>Automatic discovery</H3>
        <P>As soon as an account is connected, Easy CI fetches every accessible repository, with no configuration:</P>
        <Table
          head={["Platform", "Discovered repositories"]}
          rows={[
            ["GitHub", <>Your repositories, those you collaborate on, those of your organizations (<Code>read:org</Code> scope).</>],
            ["GitLab", "Projects you are a member of, directly or through a group or subgroup."],
            ["Bitbucket", "Repositories of the workspaces you are a member of."],
          ]}
        />
        <P>
          Each repository is then analyzed: Easy CI looks for its CI configuration (<Code>.github/workflows/*.yml</Code>, <Code>.gitlab-ci.yml</Code> or{" "}
          <Code>bitbucket-pipelines.yml</Code>) and fetches the status of the latest pipelines. Repositories without CI stay visible at the end of the list, marked "No
          pipeline detected". With several accounts, a platform filter appears above the list.
        </P>
        <Callout variant="info">
          The 1,000 most recently updated repositories are taken into account. Archived repositories are hidden by default (Settings › Synchronization).
        </Callout>

        <H3>Add a repository manually</H3>
        <P>Useful to follow an open source project, or a repository of an organization you are not a member of.</P>
        <Steps>
          <>
            <Strong>Repositories</Strong> page › <Strong>Add a repository</Strong> button (or Settings › Tracked repositories).
          </>
          <>
            Choose the platform, then type <Code>owner/repository</Code> (GitLab: <Code>group/subgroup/project</Code>) or paste the repository URL directly: the
            platform is then detected automatically (<Code>https://gitlab.com/…</Code>, <Code>git@bitbucket.org:…</Code>).
          </>
          <>Easy CI checks that the repository exists and that your credentials can access it, then adds it and opens its page.</>
        </Steps>
        <P>
          Added repositories carry the "Added" badge. To stop following one: the row's <Strong>⋯</Strong> menu › <Strong>Stop tracking</Strong>.
        </P>

        <H3>Hide a repository</H3>
        <P>
          An automatically discovered repository is cluttering the list? <Strong>⋯</Strong> menu › <Strong>Hide this repository</Strong>. It is no longer shown or
          analyzed. To show it again: Settings › Tracked repositories › Hidden › <Strong>Show again</Strong>.
        </P>

        <H3>Favorites, filters and sorting</H3>
        <P>
          Click a repository's <Strong>star</Strong> to pin it: it appears at the top of the list and in the sidebar. Filters (Failing, Running, Passing, Favorites, No
          CI) and sorting (activity, status, name) combine with search <Kbd>/</Kbd>.
        </P>
      </>
    ),
  },
  {
    id: "overview",
    title: "Overview",
    icon: LayoutDashboard,
    summary: "The dashboard: indicators, failures to fix, activity.",
    content: (
      <>
        <P>The home page summarizes the state of all your pipelines.</P>
        <Table
          head={["Block", "Content"]}
          rows={[
            ["Indicators", "Repositories with CI, running pipelines, failing workflows, success rate over recent runs."],
            ["Needs fixing", "Every workflow whose latest run failed, with the commit at fault. \"View error\" opens the diagnosis directly."],
            ["Live", "Running pipelines, with their elapsed time ticking."],
            ["Recent activity", "The latest runs of all your repositories, newest first."],
            ["Repository health", "Repositories sorted by severity, with their last 10 runs as small colored bars."],
          ]}
        />
      </>
    ),
  },
  {
    id: "repository",
    title: "Repository page",
    icon: Workflow,
    summary: "Workflows or pipelines, history and YAML files.",
    content: (
      <>
        <P>Click a repository to open its page. It has several tabs:</P>
        <H3>Workflows / Pipelines</H3>
        <P>
          GitHub shows one card per workflow; GitLab and Bitbucket, which have a single configuration file per repository, show a single "Pipeline" card. Each card
          shows the status and details of the latest run (commit, branch, trigger, duration) and a <Strong>history bar</Strong> of the last 12 runs. Each bar is
          clickable; taller bars flag failures.
        </P>
        <H3>Runs</H3>
        <P>
          The full history, filterable by workflow (left column) and by status. <Strong>Load more</Strong> goes back in time.
        </P>
        <H3>Statistics</H3>
        <P>
          Durations, success rate and unstable jobs over the latest completed runs (see Run statistics).
        </P>
        <H3>CI files</H3>
        <P>
          The configuration file with syntax highlighting, and an automatic summary: <Strong>triggers</Strong> (push, pull or merge request, schedule, tag…),{" "}
          <Strong>stages</Strong> (GitLab) or pipeline sections (Bitbucket), <Strong>jobs</Strong> with their dependencies, and <Strong>included</Strong> files (GitLab{" "}
          <Code>include:</Code>). Invalid YAML is flagged with the line at fault.
        </P>
        <P>
          The <Strong>Edit</Strong> button opens the file in the editor, provided a local folder is linked to the repository (see Edit the CI).
        </P>
      </>
    ),
  },
  {
    id: "runs",
    title: "Follow a run",
    icon: Activity,
    summary: "Statuses, live tracking, jobs and steps.",
    content: (
      <>
        <P>
          A run's page shows the commit, author, trigger, branch and duration in its header. Below: the list of <Strong>jobs</Strong> on the left, the details of
          the selected job on the right.
        </P>
        <H3>What statuses mean</H3>
        <div className="my-4 grid gap-2 sm:grid-cols-2">
          {STATES.map((state) => (
            <div key={state} className="flex items-start gap-2.5 rounded-xl border border-line bg-surface px-3 py-2.5">
              <StatusIcon state={state} className="mt-0.5" />
              <div>
                <div className="text-[13px] font-medium text-fg">{stateLabel(state)}</div>
                <div className="text-[12.5px] leading-snug text-fg-muted">{STATE_HELP[state]}</div>
              </div>
            </div>
          ))}
        </div>
        <H3>Live</H3>
        <P>
          While a run is in progress, the page updates every 3 seconds: progress bar, current step, duration. The running job is selected automatically. A
          notification appears when the run finishes.
        </P>
        <H3>Live logs</H3>
        <P>
          On <Strong>GitLab</Strong> and <Strong>Bitbucket</Strong>, a job's log is displayed and scrolls while it runs (<Strong>Live</Strong> badge). Scroll up in the
          log to pause it; click <Strong>Follow</Strong> to resume scrolling.
        </P>
        <Callout variant="warning" title="GitHub: why does the log only appear at the end of the job?">
          GitHub's API only publishes a job's log once the job has finished. While it runs, Easy CI therefore shows step-by-step progress; the full log loads by
          itself as soon as the job ends. To see the raw output live, use the <ExternalLink className="inline size-3" /> "View this job on GitHub" icon.
        </Callout>
        <H3>Jobs and steps</H3>
        <P>
          Click a job to show its log. On GitHub, its steps are listed too: clicking a step scrolls the log to the matching section. On GitLab, jobs are grouped by{" "}
          <Strong>stage</Strong>; a job allowed to fail (<Code>allow_failure</Code>) carries the "allowed" badge and doesn't fail the pipeline.
        </P>
      </>
    ),
  },
  {
    id: "errors",
    title: "Understand a failure",
    icon: ScrollText,
    summary: "Error summary, log excerpt and reading tools.",
    content: (
      <>
        <P>When a run fails, Easy CI does the searching for you.</P>
        <H3>The error summary</H3>
        <P>A red box appears at the top of the page, with for each failed job:</P>
        <ul className="my-3 ml-5 list-disc space-y-1 text-[13.5px] leading-relaxed text-fg-muted marker:text-fg-subtle">
          <li>
            the <Strong>annotations</Strong>: error message, file and line at fault. GitHub provides them directly; on GitLab, Easy CI reads JUnit test reports (
            <Code>artifacts:reports:junit</Code>) and the job's failure reason;
          </li>
          <li>
            a <Strong>log excerpt</Strong>: the lines leading up to the error (test output, stack trace…), clickable. Without an explicit error line (common on
            Bitbucket), these are the last lines before it stopped;
          </li>
          <li>
            the <Strong>View in logs</Strong> button, which opens the full log right on the error.
          </li>
        </ul>
        <H3>Reading a log</H3>
        <Table
          head={["Tool", "Use"]}
          rows={[
            ["Go to error", "Jumps to the error line; click again to move to the next one."],
            [
              <>
                Search <Kbd>⌘</Kbd> <Kbd>F</Kbd>
              </>,
              <>
                Highlights every match. <Kbd>Enter</Kbd> for the next one, <Kbd>⇧</Kbd> <Kbd>Enter</Kbd> for the previous one.
              </>,
            ],
            ["Collapsible sections", "GitHub: technical blocks collapsed by default. GitLab: runner sections. Bitbucket: one section per command. Click to collapse or expand."],
            ["Timestamps", "Shows the time of each line to spot slow steps."],
            ["Wrap lines", "Turns wrapping of long lines on or off."],
            ["Copy", "Copies the full log to the clipboard."],
          ]}
        />
        <P>
          Error lines carry a red <Strong>Error</Strong> badge, warnings an orange badge. Colors produced by your tools (tests, linters) are preserved.
        </P>
        <Callout variant="info">For very large logs, only the last 20,000 lines are shown: that's where the errors are.</Callout>
      </>
    ),
  },
  {
    id: "actions",
    title: "Re-run and cancel",
    icon: RotateCcw,
    summary: "Re-run all or part of a run, cancel.",
    content: (
      <>
        <Table
          head={["Action", "Effect"]}
          rows={[
            ["Re-run failed jobs", "GitHub and GitLab: replays only the failed jobs (and those depending on them) within the same run."],
            ["Re-run all jobs (GitHub)", "New attempt of the whole run, on the same commit (\"Attempt 2\" badge)."],
            ["Run a new pipeline (GitLab, Bitbucket)", "Creates a new pipeline on the same branch, with its latest commit. Easy CI opens it automatically."],
            ["Cancel", "Visible while a run is in progress: stops the running jobs."],
          ]}
        />
        <Callout variant="warning">
          These actions affect your real pipelines and require write permissions: <Code>repo</Code> (GitHub classic) or <Strong>Actions: Read and write</Strong>{" "}
          (fine-grained), <Code>api</Code> (GitLab), <Code>write:pipeline:bitbucket</Code> (Bitbucket).
        </Callout>
      </>
    ),
  },
  {
    id: "stats",
    title: "Run statistics",
    icon: ChartColumn,
    summary: "Durations over time, success rate, slow or unstable jobs.",
    content: (
      <>
        <P>
          A repository's <Strong>Statistics</Strong> tab summarizes its latest completed runs: 20, 50 or 100, for all workflows or a single one (left column), on
          all branches or only the default branch. Everything is computed on your machine from data the platform already provides: nothing is sent anywhere else.
        </P>
        <Table
          head={["Indicator", "Meaning"]}
          rows={[
            ["Success rate", "Successful runs among those that passed or failed (cancelled runs don't count)."],
            ["Median duration", "Half of the runs are faster. The trend compares recent runs with older ones (from a 5% difference)."],
            ["P90 duration", "9 runs out of 10 are faster: useful to spot occasional slowness."],
            ["Unstable jobs", "Number of jobs whose result changes without any code change."],
          ]}
        />
        <H3>Duration chart</H3>
        <P>
          One bar per run, from oldest to newest, colored by result, with the median as a dashed line. Hover a bar to see the number, commit, branch and duration;
          click to open the run.
        </P>
        <H3>Jobs</H3>
        <P>
          For each job: success rate, median and P90 duration, and the history of its results. An orange dot above a result means several attempts. The{" "}
          <Strong>Unstable</Strong> filter keeps only the jobs worth a look.
        </P>
        <Callout variant="warning" title="When is a job unstable?">
          When it <Strong>failed then passed on the same commit</Strong>, after a job or pipeline retry, without any code change: the signature of a flaky test. Or
          when it <Strong>often alternates</Strong> between success and failure (at least 4 changes, i.e. one every 5 runs). A job broken then fixed by a new commit
          is not unstable.
        </Callout>
        <Callout variant="info">
          The jobs of each completed run are downloaded once and kept in memory for the session: switching filters uses almost no quota.
        </Callout>
      </>
    ),
  },
  {
    id: "notifications",
    title: "Notifications",
    icon: Bell,
    summary: "Get notified when a pipeline fails or recovers.",
    content: (
      <>
        <P>
          Easy CI watches the displayed repositories at every refresh and reports each workflow's <Strong>state changes</Strong>: failing (while it was green) and
          back to green (after a failure). A pipeline that fails several times in a row is reported only once.
        </P>
        <Table
          head={["Window", "What you see"]}
          rows={[
            ["In the foreground", "A message in the app, with a View button that opens the run."],
            ["In the background or minimized", "The same message, plus a system notification. Repositories keep refreshing."],
          ]}
        />
        <P>
          When more than 3 changes are detected in the same refresh, a single message summarizes them. Nothing is reported at startup: the current state is the
          baseline.
        </P>
        <H3>Settings</H3>
        <P>
          In <Strong>Settings › Notifications</Strong>: turn notifications on or off, choose failures and/or recoveries, limit them to favorite repositories, and send
          a <Strong>test notification</Strong>.
        </P>
        <Table
          head={["System", "Mechanism"]}
          rows={[
            ["macOS", "Notification Center, shown as “Script Editor” (unsigned app). If nothing appears: System Settings › Notifications › Script Editor."],
            ["Windows", "Windows notifications, shown as Windows PowerShell. Check that notifications and Focus assist allow them."],
            ["Linux", "notify-send (libnotify-bin or libnotify package), otherwise D-Bus. Without a notification service, only in-app messages are shown."],
          ]}
        />
        <Callout variant="tip">
          To check from a terminal, start the app with <Code>--test-notification</Code>: it shows a test notification and reports the mechanism used.
        </Callout>
      </>
    ),
  },
  {
    id: "local",
    title: "Local projects",
    icon: Laptop,
    summary: "Link repositories to their clones, follow and fetch changes.",
    content: (
      <>
        <P>
          Easy CI links each tracked repository to its <Strong>clone on your machine</Strong>. Pipeline changes are made in that folder: they are written and
          committed locally, then pushed only when you decide (see Edit the CI).
        </P>
        <Callout variant="info" title="Requirements">
          Git must be installed. Easy CI uses your own Git and usual credentials (SSH key, keychain, credential manager): if <Code>git fetch</Code> works in your
          terminal, it works in Easy CI.
        </Callout>

        <H3>1. Point Easy CI to your projects folders</H3>
        <Steps>
          <>
            <Strong>Settings › Local projects</Strong> › type the folder containing your projects (for example <Code>~/Developer</Code>) or click{" "}
            <Strong>Browse…</Strong>, then <Strong>Add</Strong>.
          </>
          <>
            Easy CI scans that folder (up to 6 levels deep, ignoring <Code>node_modules</Code>, <Code>.venv</Code>, <Code>build</Code>…) and reads the remotes of each
            Git clone found.
          </>
          <>
            Every clone whose remote points to a tracked repository (GitHub, GitLab, Bitbucket, over HTTPS or SSH) is <Strong>linked automatically</Strong>. A
            computer icon then appears on the repository's row.
          </>
        </Steps>
        <P>
          Added a new project on disk? Click <Strong>Scan again</Strong>.
        </P>

        <H3>2. Link or clone a repository manually</H3>
        <P>
          Repository page › <Strong>Local project</Strong> tab:
        </P>
        <Table
          head={["Action", "Use"]}
          rows={[
            ["Link an existing folder", "The clone lives outside your projects folders. Easy CI checks that its remotes match the repository; otherwise it offers to link anyway."],
            ["Clone the repository", "No local copy yet: choose the parent folder and the protocol (HTTPS or SSH). The clone is linked as soon as it finishes."],
            ["Unlink", "⋯ menu › Unlink this folder. The folder is neither modified nor deleted, and is no longer linked automatically."],
          ]}
        />

        <H3>3. Follow the clone's state</H3>
        <Table
          head={["Indicator", "Meaning"]}
          rows={[
            ["To pull", "Commits on the tracked remote branch that aren't in your local branch yet."],
            ["To push", "Local commits not pushed to the remote branch yet."],
            ["Uncommitted", "Files modified, added or deleted in the working copy."],
            ["Last fetch", "Time of the last git fetch, by you or by automatic fetch."],
          ]}
        />
        <P>
          The <Strong>Local CI files</Strong> section compares each CI configuration file with the remote branch. Click a modified file to show line-by-line
          differences (<span className="text-failure">−</span> remote, <span className="text-success">+</span> local).
        </P>
        <div className="my-4 grid gap-2 sm:grid-cols-2">
          {CI_FILE_STATES.map((state) => (
            <div key={state} className="flex items-start gap-2.5 rounded-xl border border-line bg-surface px-3 py-2.5">
              <CiStateBadge state={state} />
              <div className="text-[12.5px] leading-snug text-fg-muted">{ciStateInfo(state).description}</div>
            </div>
          ))}
        </div>

        <H3>4. Fetch and update</H3>
        <Table
          head={["Button", "Effect"]}
          rows={[
            ["Fetch", <>Runs <Code>git fetch</Code>: updates the indicators without touching your files.</>],
            [
              "Update",
              <>
                Runs <Code>git pull --ff-only</Code>: moves the local branch forward. Disabled when there are uncommitted changes, unpushed local commits (diverged
                branches) or no tracked remote branch.
              </>,
            ],
            ["Open", "⋯ menu: show the folder, open it in your code editor (VS Code, Cursor, Zed, JetBrains…) or in a terminal."],
          ]}
        />
        <Callout variant="tip" title="Automatic fetch">
          Settings › Local projects: Easy CI can fetch changes every 5, 15 or 60 minutes, and even <Strong>update branches</Strong> automatically. That update is
          fast-forward only and never happens while you have work in progress: your changes are never overwritten.
        </Callout>
      </>
    ),
  },
  {
    id: "editing",
    title: "Edit the CI",
    icon: Pencil,
    summary: "Edit locally, validate, commit, push and open a pull request.",
    content: (
      <>
        <P>
          CI files are edited <Strong>in the repository's local clone</Strong>, never directly on the platform. Each step is a separate action: nothing leaves your
          machine until you click <Strong>Push</Strong>.
        </P>
        <Steps>
          <>
            <Strong>Open the editor</Strong>: Local project tab › a file's pencil icon (or "Open editor"), or CI files tab › <Strong>Edit</Strong>. On GitHub, the{" "}
            <FilePlus2 className="inline size-3.5" /> icon creates a new workflow from a template.
          </>
          <>
            <Strong>Edit</Strong>: YAML highlighting, automatic indentation, block folding, search (<Kbd>⌘</Kbd> <Kbd>F</Kbd>) and platform keyword suggestions (
            <Kbd>Ctrl</Kbd> <Kbd>Space</Kbd>).
          </>
          <>
            <Strong>Validate</Strong>: every change is checked live. Errors are underlined in the text and listed in the Validation tab; a click puts the cursor on the
            line. On GitLab, <Strong>Validate with GitLab</Strong> also queries the official CI Lint tool.
          </>
          <>
            <Strong>Save</Strong> (<Kbd>⌘</Kbd> <Kbd>S</Kbd>): the file is written to the local folder. If another editor changed it in the meantime, Easy CI asks you
            to reload or overwrite.
          </>
          <>
            <Strong>Commit</Strong>: choose the files, the message and the branch. From the default branch, a <Strong>new branch</Strong> is suggested (
            <Code>ci/…</Code>). The commit is local only; other modified files of the project aren't included.
          </>
          <>
            <Strong>Push</Strong>: the "Branch and publication" card shows the pending commits. The <Strong>Push…</Strong> button asks for confirmation, then pushes the
            branch with your usual Git.
          </>
          <>
            <Strong>Propose</Strong>: <Strong>Create…</Strong> opens a pull request (merge request on GitLab) to the default branch, with title, description and a
            draft option. If a proposal already exists for the branch, Easy CI shows it instead of creating a second one.
          </>
        </Steps>

        <H3>What validation checks</H3>
        <Table
          head={["Platform", "Checks"]}
          rows={[
            ["All", "YAML syntax (tabs, indentation, quotes), unclosed ${{ }} expressions, unknown keys (warning)."],
            ["GitHub Actions", "on and jobs present, runs-on, non-empty steps, \"uses\" or \"run\" per step, action versions (@v4), existing needs without cycles, 5-field cron."],
            ["GitLab CI", "script or trigger per job, declared stages, existing needs and extends, rules not combined with only/except, when values. Optional official CI Lint validation."],
            ["Bitbucket Pipelines", "pipelines section, known sections, script in every step, valid size, trigger and max-time."],
          ]}
        />
        <Callout variant="info">
          A file with errors can be saved (work in progress) but committing it is discouraged: Easy CI flags it and asks for explicit confirmation.
        </Callout>

        <H3>Undo a change</H3>
        <Table
          head={["Button", "Effect"]}
          rows={[
            ["Undo", "Reverts to the content saved on disk (unsaved editor changes)."],
            ["Restore", "Reverts to the last committed version (git restore). For a new, never-committed file, deletes it. Asks for confirmation."],
          ]}
        />

        <H3>Required permissions</H3>
        <P>
          Pushing uses your Git credentials (SSH or credential manager). Creating a pull request uses the connected account: <Code>repo</Code> or{" "}
          <Strong>Pull requests: Read and write</Strong> (GitHub), <Code>api</Code> (GitLab), <Code>write:pullrequest:bitbucket</Code> (Bitbucket).
        </P>
      </>
    ),
  },
  {
    id: "generate",
    title: "Generate a pipeline",
    icon: Zap,
    summary: "Create CI suited to the project's stack in a few clicks, without AI.",
    content: (
      <>
        <P>
          The generation wizard analyzes the files of the <Strong>local clone</Strong> and produces a complete pipeline for GitHub Actions, GitLab CI/CD or Bitbucket
          Pipelines. It relies solely on <Strong>deterministic templates</Strong>: no AI, no content sent to a third-party service, and the same choices always give
          the same file.
        </P>
        <Steps>
          <>
            <Strong>Open the wizard</Strong>: <Strong>Generate a pipeline</Strong> button on a repository without CI, <Strong>Generate</Strong> button in the Local
            project tab, or the <Zap className="inline size-3.5" /> icon in the editor. A local folder must be linked to the repository.
          </>
          <>
            <Strong>Analysis</Strong>: detected stacks are shown with their framework, version (and the file that states it), package manager and supporting files.
            Turn a stack off to exclude it. A Dockerfile, hosting files and existing CI are flagged too.
          </>
          <>
            <Strong>Steps</Strong>: install, lint, type checking, tests and build are prefilled from your scripts. Each command can be edited or turned off. You can
            test several versions (matrix), enable caching and, on GitHub, several operating systems.
          </>
          <>
            <Strong>Triggers</Strong>: push to the default branch, pull/merge requests, <Code>v*</Code> tags, manual run, scheduled run and cancellation of outdated
            runs.
          </>
          <>
            <Strong>Delivery</Strong> (optional): build and push a Docker image (ghcr.io, GitLab registry, Docker Hub…) and a deployment job with environment,
            secrets and manual approval. Command templates are suggested when a Netlify, Vercel, Fly.io, Cloudflare, Render, Firebase or Serverless file is
            detected.
          </>
          <>
            <Strong>Review and write</Strong>: summary of the jobs, actions to take on the platform (secrets to create, schedules…), then{" "}
            <Strong>Write to the local folder</Strong>. The file opens in the editor: review, commit, push and propose it like any change.
          </>
        </Steps>
        <Callout variant="tip" title="Live preview">
          The generated YAML is shown on the right throughout the configuration, validated on every change. The copy button also lets you paste it elsewhere.
        </Callout>

        <H3>Recognized stacks</H3>
        <Table
          head={["Stack", "Detection", "Derived commands"]}
          rows={[
            ["Node.js", "package.json, npm / pnpm / Yarn / Bun lockfile, .nvmrc, engines", "lint, typecheck, test, build scripts; tsc --noEmit for TypeScript"],
            ["Python", "pyproject.toml, requirements*.txt, uv.lock, poetry.lock, Pipfile, .python-version", "ruff / flake8, mypy / pyright, pytest or manage.py test, build"],
            ["Go", "go.mod (version), .golangci.yml", "go vet or golangci-lint, go test -race, go build"],
            ["Rust", "Cargo.toml, rust-toolchain.toml", "cargo fmt + clippy, cargo test, cargo build --release"],
            ["Java / Kotlin", "pom.xml, build.gradle(.kts), mvnw / gradlew wrappers", "mvn verify / gradle test, package / build"],
            ["Android", "com.android plugin in Gradle", "gradlew lint, testDebugUnitTest, assembleDebug"],
            ["PHP", "composer.json (Laravel, Symfony)", "pint / php-cs-fixer, phpstan, phpunit / pest / artisan test"],
            ["Ruby", "Gemfile, .ruby-version (Rails)", "rubocop, rspec or rails test"],
            [".NET", ".sln / .csproj (TargetFramework)", "dotnet format, dotnet test, dotnet build"],
          ]}
        />
        <P>
          In a monorepo, first-level subfolders are analyzed too (for example <Code>frontend/</Code> and <Code>api/</Code>): each stack gets its own jobs, running in
          its folder. Packages managed by a root workspace (npm, pnpm, Yarn, Cargo, Gradle modules) aren't duplicated.
        </P>

        <H3>Platform specifics</H3>
        <Table
          head={["Platform", "Generated file"]}
          rows={[
            ["GitHub Actions", "A workflow in .github/workflows (editable name), up-to-date official actions, minimal permissions, caching built into setup-* actions, Docker image with GitHub cache."],
            ["GitLab CI/CD", ".gitlab-ci.yml with workflow:rules (no duplicate pipelines), stages, a hidden template per stack (extends), parallel:matrix, JUnit report for pytest, manual deployment via when: manual."],
            ["Bitbucket Pipelines", "bitbucket-pipelines.yml with steps defined once (YAML anchors) and reused for the default branch, pull requests, tags and custom pipelines."],
          ]}
        />
        <Callout variant="info">
          If the file already exists in the local folder, the wizard asks you to confirm replacing it. As long as nothing is committed, <Strong>Restore</Strong> in the
          editor brings back the previous version.
        </Callout>
      </>
    ),
  },
  {
    id: "refresh",
    title: "Refresh and quota",
    icon: Gauge,
    summary: "Update frequency and platform rate limits.",
    content: (
      <>
        <P>
          Repositories are re-checked automatically at the frequency chosen in Settings › Synchronization (1 minute by default). Repositories with a run in progress
          are followed every 8 seconds. Press <Kbd>R</Kbd> to refresh everything immediately.
        </P>
        <P>
          Each platform limits the number of calls: <Strong>5,000 per hour</Strong> for GitHub, about <Strong>2,000 per minute</Strong> for gitlab.com (varies on a
          self-managed instance), <Strong>1,000 per hour</Strong> for Bitbucket. Easy CI limits concurrent scans, caches finished pipelines and uses conditional
          requests. The <Strong>Quota</Strong> gauges at the bottom of the sidebar show consumption when the platform reports it.
        </P>
      </>
    ),
  },
  {
    id: "shortcuts",
    title: "Keyboard shortcuts",
    icon: Keyboard,
    summary: "Navigate and act without the mouse.",
    content: (
      <Table
        head={["Shortcut", "Action"]}
        rows={[
          [<><Kbd>⌘</Kbd> <Kbd>K</Kbd></>, "Command palette: repositories, pages, theme, refresh, sign out."],
          [<Kbd>/</Kbd>, "Search (the page's filter field, otherwise the palette)."],
          [<Kbd>R</Kbd>, "Refresh all."],
          [<><Kbd>⌘</Kbd> <Kbd>F</Kbd></>, "Search in the displayed log or in the editor."],
          [<><Kbd>⌘</Kbd> <Kbd>S</Kbd></>, "Save the CI file to the local folder (editor)."],
          [<><Kbd>Ctrl</Kbd> <Kbd>Space</Kbd></>, "Suggest platform keywords (editor)."],
          [<><Kbd>Enter</Kbd> / <Kbd>⇧</Kbd> <Kbd>Enter</Kbd></>, "Next / previous match in the log."],
          [<Kbd>Esc</Kbd>, "Close the palette or a dialog, clear the log search."],
        ]}
      />
    ),
  },
  {
    id: "settings",
    title: "Settings",
    icon: Settings,
    summary: "Accounts, tracked repositories, language, appearance, synchronization, notifications, updates.",
    content: (
      <Table
        head={["Section", "Settings"]}
        rows={[
          ["Accounts", "One account per platform: sign in, sign out, credential storage, messages when credentials expire."],
          ["Tracked repositories", "Manually added repositories and hidden repositories."],
          ["Local projects", "Projects folders, clone detection, automatic fetch and update, code editor."],
          ["Appearance", "Interface language (system, French or English) and light, dark or system theme."],
          ["Synchronization", "Refresh frequency (30 s to 5 min, or manual), showing repositories without CI and archived repositories."],
          ["Notifications", "Notifications for failing or recovered pipelines, repositories concerned (all or favorites), test notification."],
          ["Updates", "Installed version, manual or automatic checks for new versions, skipped versions."],
        ]}
      />
    ),
  },
  {
    id: "updates",
    title: "Installation and updates",
    icon: CircleArrowUp,
    summary: "Install Easy CI with one command and get notified of new versions.",
    content: (
      <>
        <P>Easy CI installs with a single command on each system. Git is still required for local projects.</P>
        <H3>macOS</H3>
        <P>
          With Homebrew (the brew trust command, required since Homebrew 7, approves this third-party tap): updates with brew upgrade, but right-click › Open on
          first launch (Homebrew applies quarantine).
        </P>
        <CodeBlock>{"brew trust --tap rodolphe37/easy-ci && brew tap rodolphe37/easy-ci && brew install --cask easy-ci"}</CodeBlock>
        <P>Or with the install script: no Gatekeeper warning; run it again to update.</P>
        <CodeBlock>{"curl -fsSL https://raw.githubusercontent.com/rodolphe37/easy-ci/main/packaging/macos/install.sh | bash"}</CodeBlock>
        <H3>Linux</H3>
        <P>Installs into ~/.local/share/easy-ci, with the easy-ci command and an application menu entry.</P>
        <CodeBlock>{"curl -fsSL https://raw.githubusercontent.com/rodolphe37/easy-ci/main/packaging/linux/install.sh | bash"}</CodeBlock>
        <H3>Windows</H3>
        <P>In PowerShell: installs into the user's programs folder, with a Start menu shortcut.</P>
        <CodeBlock>{"irm https://raw.githubusercontent.com/rodolphe37/easy-ci/main/packaging/windows/install.ps1 | iex"}</CodeBlock>

        <H3>Get notified of a new version</H3>
        <P>
          At startup and then every 6 hours, Easy CI asks GitHub for the latest published version. If it is newer, a dialog shows what's new and the{" "}
          <Strong>upgrade command matching your installation</Strong> (Homebrew, script or PowerShell) with a Copy button: paste it into a terminal, then restart the
          app. Your accounts and settings are kept.
        </P>
        <Table
          head={["Button", "Effect"]}
          rows={[
            ["Later", "Closes the dialog; the \"Update available\" reminder stays at the bottom of the sidebar."],
            ["Skip this version", "No more reminders for this version; later versions will be reported. Can be undone in Settings › Updates."],
            ["View release", "Opens the release page on GitHub (full notes, manual download)."],
          ]}
        />
        <Callout variant="info">
          The check sends no personal data and can be turned off in <Strong>Settings › Updates</Strong>, where the <Strong>Check</Strong> button also runs an immediate
          check.
        </Callout>
      </>
    ),
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    icon: CircleHelp,
    summary: "Common problems and their solutions.",
    content: (
      <>
        <Question question="Security warning on first launch">
          <P>
            Downloaded builds aren't signed. On macOS, right-click <Code>EasyCI.app</Code> › <Strong>Open</Strong> (only once), or run{" "}
            <Code>xattr -dr com.apple.quarantine /Applications/EasyCI.app</Code>. On Windows, in the SmartScreen dialog: <Strong>More info › Run anyway</Strong>.
          </P>
        </Question>
        <Question question={'"Invalid or expired credentials"'}>
          <P>
            The token expired, was revoked or was copied incorrectly. Only the affected account is disconnected. Create a new token (Connect GitHub, GitLab, Bitbucket
            sections), then Settings › Accounts › <Strong>Connect</Strong>.
          </P>
        </Question>
        <Question question="Bitbucket rejects my credentials">
          <P>
            With a personal API token, the field expects your <Strong>Atlassian account email address</Strong>, not your Bitbucket username. Also check that the token
            was created for the Bitbucket app, with the read scopes listed in the Connect Bitbucket section.
          </P>
        </Question>
        <Question question="A GitLab project has no pipeline detected">
          <P>
            Easy CI looks for the file defined in Settings › CI/CD › <i>CI/CD configuration file</i> (<Code>.gitlab-ci.yml</Code> by default) on the default branch.
            Also check that CI/CD is enabled for the project and that your role can see pipelines (Reporter or higher).
          </P>
        </Question>
        <Question question="A repository of my organization doesn't show up">
          <P>Check, in order, that:</P>
          <ul className="ml-5 list-disc space-y-1 text-[13.5px] leading-relaxed text-fg-muted">
            <li>
              the classic token has the <Code>read:org</Code> scope;
            </li>
            <li>
              the token is <Strong>authorized for the organization's SSO</Strong> (Configure SSO › Authorize);
            </li>
            <li>for a fine-grained token: the organization is the "Resource owner" and the repository is included;</li>
            <li>the repository is neither archived (see Settings) nor hidden.</li>
          </ul>
          <P>
            You can also add it manually with <Strong>Add a repository</Strong>: the error message will tell you if the token can't access it.
          </P>
        </Question>
        <Question question={'"Access denied" when re-running or cancelling'}>
          <P>
            The token only has read permissions. GitHub: <Code>repo</Code> or <Strong>Actions: Read and write</Strong>. GitLab: <Code>api</Code> and a Developer role
            or higher. Bitbucket: <Code>write:pipeline:bitbucket</Code>.
          </P>
        </Question>
        <Question question={'"API rate limit reached"'}>
          <P>
            The hourly quota is exhausted, often because of a large number of repositories or other tools using the same account. It resets within an hour. Space out
            refreshes (Settings › Synchronization) and hide unneeded repositories.
          </P>
        </Question>
        <Question question="The log stays empty while running">
          <P>
            On GitHub, that's expected: the log is only published at the end of the job, while step progress remains visible live. On GitLab and Bitbucket, the log
            appears as soon as the runner has started the job.
          </P>
        </Question>
        <Question question="I have to sign in again at every launch (Linux)">
          <P>
            No keychain is available on the system. Install and start a Secret Service compatible service (GNOME Keyring, KWallet), or set the platform's environment
            variable (<Code>EASY_CI_GITHUB_TOKEN</Code>, <Code>EASY_CI_GITLAB_TOKEN</Code>…).
          </P>
        </Question>
        <Question question={'"Git identity not configured" when committing'}>
          <P>Git needs a name and an email address to sign commits. In a terminal:</P>
          <CodeBlock>{'git config --global user.name "Your Name"\ngit config --global user.email you@example.com'}</CodeBlock>
        </Question>
        <Question question="Creating a pull request fails">
          <P>
            Check that the branch was pushed, that it differs from the target branch and that the account's token is allowed to create pull requests (see Edit the CI
            › Required permissions).
          </P>
        </Question>
        <Question question="A local clone isn't linked to its repository">
          <P>
            Check that its folder is inside a projects folder (less than 6 levels deep, outside ignored folders) and that one of its remotes points to the repository (
            <Code>git remote -v</Code>). For self-managed GitLab, the instance's account must be connected. Otherwise, link it manually from the Local project tab.
          </P>
        </Question>
        <Question question={'"Git could not authenticate" when fetching or cloning'}>
          <P>
            Easy CI can't show a password prompt. Set up prompt-free access: an SSH key loaded in the agent, or a Git credential manager (<Code>gh auth setup-git</Code>{" "}
            for GitHub, Git Credential Manager…). Then check that <Code>git fetch</Code> works in a terminal.
          </P>
        </Question>
        <Question question={'"The Easy CI engine is not responding"'}>
          <P>The interface can't reach the Python engine. Quit and restart the app; if the problem persists, launch it from a terminal:</P>
          <CodeBlock>easy-ci --debug</CodeBlock>
        </Question>
      </>
    ),
  },
  {
    id: "privacy",
    title: "Privacy",
    icon: ShieldCheck,
    summary: "What is stored, and where.",
    content: (
      <>
        <P>
          Easy CI runs entirely on your computer: no Easy CI account, no intermediate server. The app only communicates with the platforms you connect (
          <Code>api.github.com</Code>, your GitLab instance, <Code>api.bitbucket.org</Code>) and, for update checks, with the public Easy CI releases API on GitHub
          (can be turned off in Settings › Updates). No telemetry, no AI.
        </P>
        <Table
          head={["Data", "Location"]}
          rows={[
            ["Credentials (tokens, Bitbucket email)", "System secure keychain, one entry per platform."],
            [
              "Settings (language, theme, favorites, added or hidden repositories)",
              <>
                <Code>settings.json</Code> in <Code>~/Library/Application Support/Easy CI</Code> (macOS), <Code>%LOCALAPPDATA%\Easy CI</Code> (Windows),{" "}
                <Code>~/.config/Easy CI</Code> (Linux).
              </>,
            ],
            ["Projects folders and repository ↔ folder links", <><Code>settings.json</Code> (paths only: the content of your projects is never copied).</>],
            ["Repositories, runs, logs", "In memory only, for the duration of the session."],
          ]}
        />
      </>
    ),
  },
];
