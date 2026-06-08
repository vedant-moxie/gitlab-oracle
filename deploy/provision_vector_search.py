"""Create the Vertex AI Vector Search index + public endpoint (STREAM_UPDATE).

Run AFTER enabling APIs. Prints the IDs to paste into .env.
NOTE: deploying the index to an endpoint takes ~20-40 min and the endpoint
is a billable, always-on resource. Undeploy it when not demoing:
    gcloud ai index-endpoints undeploy-index ENDPOINT_ID \
        --deployed-index-id=gitlab_oracle_deployed --region=REGION
"""
from __future__ import annotations

from google.cloud import aiplatform

import config

DISPLAY = "gitlab-oracle"


def main():
    aiplatform.init(project=config.PROJECT_ID, location=config.LOCATION)

    print("Creating STREAM_UPDATE brute-force index (exact search, ideal at our scale)...")
    index = aiplatform.MatchingEngineIndex.create_brute_force_index(
        display_name=f"{DISPLAY}-index",
        dimensions=config.EMBEDDING_DIM,
        distance_measure_type="DOT_PRODUCT_DISTANCE",
        shard_size="SHARD_SIZE_SMALL",
        index_update_method="STREAM_UPDATE",
        description="GitLab Oracle institutional memory",
    )
    print(f"INDEX_ID={index.name}")

    print("Creating public index endpoint...")
    endpoint = aiplatform.MatchingEngineIndexEndpoint.create(
        display_name=f"{DISPLAY}-endpoint",
        public_endpoint_enabled=True,
    )
    print(f"ENDPOINT_ID={endpoint.name}")

    print("Deploying index to endpoint (~20-40 min)...")
    endpoint.deploy_index(
        index=index,
        deployed_index_id=config.VECTOR_DEPLOYED_INDEX_ID,
        min_replica_count=1,
        max_replica_count=1,
    )
    print("\n✅ Provisioned. Add these to your .env:")
    print(f"VECTOR_INDEX_ID={index.name}")
    print(f"VECTOR_INDEX_ENDPOINT_ID={endpoint.name}")
    print(f"VECTOR_DEPLOYED_INDEX_ID={config.VECTOR_DEPLOYED_INDEX_ID}")


if __name__ == "__main__":
    main()
