from dotenv import load_dotenv
load_dotenv()

import logging
import os
logging.basicConfig(level=logging.INFO)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from db import SessionLocal, run_migrations
import models  # noqa: F401
from seed import run_seed
from routers.imports import router as imports_router
from routers.transactions import router as transactions_router
from routers.budget import router as budget_router
from routers.rules import router as rules_router
from routers.dashboard import router as dashboard_router
from routers.categories import router as categories_router
from routers.settings import router as settings_router
from routers.set_asides import router as set_asides_router
from routers.chat import router as chat_router
from routers.recurring import router as recurring_router
from routers.goals import router as goals_router
from assistant import service as chat_service
import nudges

app = FastAPI(title="Household Finance")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

run_migrations()

app.include_router(imports_router)
app.include_router(transactions_router)
app.include_router(budget_router)
app.include_router(rules_router)
app.include_router(dashboard_router)
app.include_router(categories_router)
app.include_router(settings_router)
app.include_router(set_asides_router)
app.include_router(chat_router)
app.include_router(recurring_router)
app.include_router(goals_router)

with SessionLocal() as session:
    run_seed(session)

chat_service.resume()
if os.getenv("NUDGES", "on") != "off":
    nudges.start()

@app.get("/health")
def health():
    return {"status": "ok"}
