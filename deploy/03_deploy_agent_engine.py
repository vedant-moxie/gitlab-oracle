"""Deploy the Oracle to Vertex AI Agent Engine (managed runtime).

Run from project root (after provisioning + ingestion):
    PYTHONPATH=. ./venv/bin/python deploy/03_deploy_agent_engine.py

The deployed agent reads the GitLab PAT from Secret Manager via the Agent Engine
service account (grant it roles/secretmanager.secretAccessor). Non-secret config
is passed as env vars so the remote agent points at the same index/Firestore.
"""
from __future__ import annotations

import vertexai
from google.cloud import storage
from vertexai import agent_engines
from vertexai.preview.reasoning_engines import AdkApp

import config
from agent.agent import root_agent

STAGING_BUCKET = f"gs://{config.PROJECT_ID}-agent-engine"


def _ensure_bucket():
    client = storage.Client(project=config.PROJECT_ID)
    name = STAGING_BUCKET.removeprefix("gs://")
    if not client.lookup_bucket(name):
        client.create_bucket(name, location=config.LOCATION)
        print(f"created staging bucket {STAGING_BUCKET}")


def main():
    _ensure_bucket()
    vertexai.init(project=config.PROJECT_ID, location=config.LOCATION,
                  staging_bucket=STAGING_BUCKET)

    app = AdkApp(agent=root_agent, enable_tracing=True)

    remote = agent_engines.create(
        agent_engine=app,
        display_name="gitlab-oracle",
        description="Institutional-memory agent over a repo's full GitLab history.",
        requirements=[
            "google-adk>=1.0.0",
            "google-cloud-aiplatform[adk,agent_engines]>=1.95.0",
            "google-cloud-firestore>=2.16.0",
            "google-cloud-secret-manager>=2.20.0",
            "python-gitlab>=4.4.0",
        ],
        extra_packages=["agent", "ingestion", "config.py"],
        env_vars={
            "GOOGLE_CLOUD_PROJECT": config.PROJECT_ID,
            "GOOGLE_CLOUD_LOCATION": config.LOCATION,
            "GITLAB_URL": config.GITLAB_URL,
            "VECTOR_INDEX_ID": config.VECTOR_INDEX_ID,
            "VECTOR_INDEX_ENDPOINT_ID": config.VECTOR_INDEX_ENDPOINT_ID,
            "VECTOR_DEPLOYED_INDEX_ID": config.VECTOR_DEPLOYED_INDEX_ID,
            "EMBEDDING_MODEL": config.EMBEDDING_MODEL,
            "AGENT_MODEL": config.AGENT_MODEL,
        },
    )
    print(f"\n✅ Deployed to Agent Engine:\n{remote.resource_name}")


if __name__ == "__main__":
    main()
