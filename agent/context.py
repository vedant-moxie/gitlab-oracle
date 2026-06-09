import contextvars

current_project_id = contextvars.ContextVar("current_project_id", default="")
current_gitlab_token = contextvars.ContextVar("current_gitlab_token", default="")
