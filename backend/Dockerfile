FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV DB_PATH=/app/data/library.db
ENV WORKSPACE_ROOT=/root/.hermes/workspaces

EXPOSE 3001

CMD ["python", "library_bridge.py"]
