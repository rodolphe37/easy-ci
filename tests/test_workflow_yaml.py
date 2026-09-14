from easy_ci.workflow_yaml import summarize, summarize_bitbucket_pipelines, summarize_gitlab_ci

GITLAB = """
include:
  - template: Security/SAST.gitlab-ci.yml
  - local: /ci/deploy.yml

stages: [build, test, deploy]

workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
    - if: $CI_COMMIT_TAG

.node:
  image: node:22

build:
  extends: .node
  stage: build
  script:
    - npm ci
    - npm run build

unit-tests:
  stage: test
  image: { name: "node:22" }
  needs: [build]
  parallel:
    matrix:
      - NODE: ["20", "22"]
  script:
    - !reference [.node, before_script]
    - npm test

deploy:
  stage: deploy
  tags: [docker, prod]
  needs:
    - job: unit-tests
  script: ./deploy.sh
  only: [schedules]
"""

BITBUCKET = """
image: node:22
definitions:
  steps:
    - step: &test
        name: Tests
        script:
          - npm ci
          - npm test
pipelines:
  default:
    - step: *test
  branches:
    main:
      - parallel:
          steps:
            - step: *test
            - step:
                name: Lint
                script: [npm run lint]
      - step:
          name: Deploy
          deployment: production
          script: [./deploy.sh]
  pull-requests:
    "**":
      - step: *test
  custom:
    release:
      - stage:
          name: Release
          steps:
            - step:
                name: Publish
                image: python:3.13
                script: [make publish]
"""


def test_gitlab_summary():
    summary = summarize_gitlab_ci(GITLAB)
    assert summary["valid"] is True
    assert summary["stages"] == ["build", "test", "deploy"]
    assert summary["includes"] == ["Security/SAST.gitlab-ci.yml", "/ci/deploy.yml"]
    jobs = {job["id"]: job for job in summary["jobs"]}
    assert set(jobs) == {"build", "unit-tests", "deploy"}  # le modèle caché .node est ignoré
    assert jobs["unit-tests"]["needs"] == ["build"] and jobs["unit-tests"]["matrix"] is True
    assert jobs["unit-tests"]["runs_on"] == "node:22"
    assert jobs["deploy"]["needs"] == ["unit-tests"] and jobs["deploy"]["runs_on"] == "docker, prod"
    events = {t["event"]: t["details"] for t in summary["triggers"]}
    assert events == {"merge_request": [], "push": ["branche par défaut"], "tag": [], "schedule": []}


def test_gitlab_default_trigger_and_invalid_yaml():
    assert summarize_gitlab_ci("test:\n  script: [make]\n")["triggers"] == [{"event": "push", "details": ["toutes les branches"]}]
    broken = summarize_gitlab_ci("test:\n  script: [make\n")
    assert broken["valid"] is False and broken["error_line"]


def test_bitbucket_summary():
    summary = summarize_bitbucket_pipelines(BITBUCKET)
    assert summary["valid"] is True
    events = {t["event"]: t["details"] for t in summary["triggers"]}
    assert events == {"push": ["toutes les branches", "main"], "pull_request": ["**"], "manual": ["release"]}
    names = [(job["stage"], job["name"]) for job in summary["jobs"]]
    assert names == [
        ("default", "Tests"),
        ("branches: main", "Tests"),
        ("branches: main", "Lint"),
        ("branches: main", "Deploy"),
        ("pull-requests: **", "Tests"),
        ("custom: release", "Publish"),
    ]
    publish = summary["jobs"][-1]
    assert publish["runs_on"] == "python:3.13"
    assert summary["jobs"][3]["uses"] == "déploiement : production"


def test_dispatch_by_provider():
    assert summarize("github", "on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n")["jobs"][0]["runs_on"] == "ubuntu-latest"
    assert summarize("bitbucket", "image: x\n")["valid"] is False
