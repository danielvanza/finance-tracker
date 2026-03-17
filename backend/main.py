from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from db import Base, engine
import models  # noqa: F401

app = FastAPI(title="Household Finance")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

Base.metadata.create_all(bind=engine)

@app.get("/health")
def health():
    return {"status": "ok"}
