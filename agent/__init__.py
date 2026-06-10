import os
import certifi
os.environ['GRPC_DEFAULT_SSL_ROOTS_FILE_PATH'] = certifi.where()

from .agent import root_agent

__all__ = ["root_agent"]
