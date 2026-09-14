"""Arborescences fictives des projets du mode démo, pour montrer la détection de stack."""

from __future__ import annotations

import json

from easy_ci.providers import split_repo_key


def _package(name: str, scripts: dict[str, str], dependencies: dict[str, str], dev: dict[str, str] | None = None, **extra: object) -> str:
    return json.dumps({"name": name, "private": True, "scripts": scripts, "dependencies": dependencies, "devDependencies": dev or {}, **extra}, indent=2)


_TREES: dict[str, dict[str, str]] = {
    "acme/handbook": {
        "package.json": _package(
            "handbook",
            {"dev": "astro dev", "build": "astro build", "check": "astro check", "lint": "eslint .", "test": "vitest run"},
            {"astro": "^5.12.0", "@astrojs/starlight": "^0.35.0"},
            {"typescript": "^5.9.2", "eslint": "^9.33.0", "vitest": "^3.2.4"},
            packageManager="pnpm@10.15.0",
        ),
        "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
        ".nvmrc": "22\n",
        "tsconfig.json": "{}",
        "astro.config.mjs": "export default {}\n",
        "src/content/docs/index.mdx": "# Handbook\n",
        "Dockerfile": "FROM node:22-alpine AS build\nWORKDIR /app\nCOPY . .\nRUN corepack enable && pnpm install --frozen-lockfile && pnpm build\n\nFROM nginx:alpine\nCOPY --from=build /app/dist /usr/share/nginx/html\n",
        "netlify.toml": "[build]\ncommand = \"pnpm build\"\npublish = \"dist\"\n",
        "README.md": "# Handbook\n",
    },
    "acme/storefront": {
        "package.json": _package(
            "storefront",
            {"dev": "next dev", "build": "next build", "lint": "next lint", "typecheck": "tsc --noEmit", "test": "vitest run", "e2e": "playwright test"},
            {"next": "15.5.0", "react": "19.1.0"},
            {"typescript": "^5.9.2", "vitest": "^3.2.4"},
        ),
        "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
        ".nvmrc": "22\n",
        "tsconfig.json": "{}",
        "Dockerfile": "FROM node:22-alpine\n",
        "vercel.json": "{}",
    },
    "acme/payments-api": {
        "go.mod": "module github.com/acme/payments-api\n\ngo 1.25\n\nrequire github.com/go-chi/chi/v5 v5.2.2\n",
        "go.sum": "",
        ".golangci.yml": "version: \"2\"\n",
        "cmd/api/main.go": "package main\n",
        "Dockerfile": "FROM golang:1.25 AS build\n",
        "k8s/deployment.yaml": "kind: Deployment\n",
    },
    "platform/backend/billing-service": {
        "pyproject.toml": "[project]\nname = \"billing-service\"\nrequires-python = \">=3.12\"\ndependencies = [\"fastapi\", \"sqlalchemy\"]\n\n[dependency-groups]\ndev = [\"pytest\", \"ruff\", \"mypy\"]\n\n[tool.ruff]\nline-length = 120\n",
        "uv.lock": "version = 1\n",
        ".python-version": "3.12\n",
        "tests/test_invoices.py": "",
        "Dockerfile": "FROM python:3.12-slim\n",
    },
    "platform/frontend/customer-portal": {
        "package.json": _package("customer-portal", {"dev": "vite", "build": "vite build", "lint": "eslint .", "type-check": "vue-tsc --noEmit", "test:unit": "vitest run"}, {"vue": "^3.5.18"}, {"vite": "^7.1.0", "typescript": "^5.9.2"}),
        "package-lock.json": "{}",
        ".nvmrc": "24\n",
    },
    "acme-team/marketing-site": {
        "package.json": _package("marketing-site", {"dev": "astro dev", "build": "astro build"}, {"astro": "^5.12.0"}),
        "package-lock.json": "{}",
    },
    "acme-team/data-importer": {
        "pyproject.toml": "[tool.poetry]\nname = \"data-importer\"\n\n[tool.poetry.dependencies]\npython = \"^3.12\"\npandas = \"^2.3\"\n\n[tool.poetry.group.dev.dependencies]\npytest = \"^8.4\"\nflake8 = \"^7.3\"\n",
        "poetry.lock": "",
        "tests/test_import.py": "",
    },
    "acme/mobile-app": {
        "settings.gradle.kts": "pluginManagement { plugins { id(\"com.android.application\") } }\ninclude(\":app\")\n",
        "build.gradle.kts": "plugins { id(\"com.android.application\") version \"8.12.0\" apply false }\n",
        "app/build.gradle.kts": "plugins { id(\"com.android.application\") }\nkotlin { jvmToolchain(17) }\n",
        "gradlew": "#!/bin/sh\n",
    },
    "acme/data-pipeline": {
        "requirements.txt": "apache-airflow==3.0.4\npandas==2.3.1\n",
        "requirements-dev.txt": "-r requirements.txt\npytest==8.4.1\nruff==0.12.8\n",
        "tests/test_dags.py": "",
    },
    "acme/design-system": {
        "package.json": _package("design-system", {"build": "tsup", "lint": "eslint .", "test": "vitest run", "storybook": "storybook dev"}, {"react": "^19.1.0"}, {"typescript": "^5.9.2"}, workspaces=["packages/*"]),
        "yarn.lock": "",
        ".yarnrc.yml": "nodeLinker: node-modules\n",
        "tsconfig.json": "{}",
    },
}

_FALLBACK = {
    "package.json": _package("app", {"build": "vite build", "test": "vitest run"}, {"react": "^19.1.0"}, {"vite": "^7.1.0"}),
    "package-lock.json": "{}",
}


def demo_project_tree(key: str) -> dict[str, str]:
    _, full_name = split_repo_key(key)
    return _TREES.get(full_name, _FALLBACK)
