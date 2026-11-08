from dotenv import load_dotenv
load_dotenv()

import logging
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
from routers.standing_adjustments import router as standing_adjustments_router

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
app.include_router(standing_adjustments_router)

with SessionLocal() as session:
    run_seed(session)

@app.get("/health")
def health():
    return {"status": "ok"}
