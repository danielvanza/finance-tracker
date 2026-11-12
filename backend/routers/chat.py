from typing import Literal

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel

from assistant import service

router = APIRouter(prefix="/chat", tags=["chat"])

Channel = Literal["bubble", "telegram"]


class ChatMessageIn(BaseModel):
    channel: Channel
    text: str = ""
    choose_transaction_id: int | None = None
    seen_message_id: int | None = None  # the newest message on this person's screen


class ApplyIn(BaseModel):
    version: str  # the card's version that was on screen when it was tapped


class DeliveredIn(BaseModel):
    message_ids: list[int]


def _found(call, *args):
    try:
        return call(*args)
    except service.NotFound:
        raise HTTPException(404, "Not found") from None


@router.get("/messages")
def get_messages(channel: Channel):
    return service.conversation(channel)


@router.post("/messages", status_code=202)
def post_message(body: ChatMessageIn):
    if not body.text.strip() and body.choose_transaction_id is None:
        raise HTTPException(422, "Say something first")
    return _found(
        service.submit_text, body.channel, body.text.strip(), body.choose_transaction_id, body.seen_message_id,
    )


class ChannelIn(BaseModel):
    channel: Channel


@router.post("/new")
def post_new_chat(body: ChannelIn):
    service.new_chat(body.channel)
    return {"new_chat": body.channel}


@router.post("/stop")
def post_stop(body: ChannelIn):
    return {"stopped": service.stop(body.channel)}


@router.get("/outbox")
def get_outbox(channel: Channel):
    return service.outbox(channel)


@router.post("/messages/{message_id}/delivered")
def post_delivered(message_id: int, body: DeliveredIn):
    _found(service.mark_delivered, message_id, body.message_ids)
    return {"delivered": message_id}


@router.get("/messages/{message_id}/chart")
def get_chart(message_id: int, theme: Literal["day", "night"] = "day"):
    png = _found(service.chart_of, message_id, theme)
    return Response(png, media_type="image/png", headers={"Cache-Control": "private, max-age=86400"})


@router.post("/files", status_code=202)
def post_file(channel: Channel = Form(...), file: UploadFile = File(...)):
    return service.submit_file(channel, file.filename or "", file.file.read())


@router.post("/voice", status_code=202)
def post_voice(channel: Channel = Form(...), file: UploadFile = File(...)):
    """A voice note. `heard` is what was understood, or null when it could not be made out."""
    return service.submit_voice(channel, file.file.read())


@router.post("/photos", status_code=202)
def post_photo(channel: Channel = Form(...), caption: str = Form(""), file: UploadFile = File(...)):
    return service.submit_photo(channel, file.file.read(), caption)


class AnswerIn(BaseModel):
    option: int  # which of the question's buttons was tapped


@router.post("/questions/{message_id}/answer")
def answer_question(message_id: int, body: AnswerIn):
    return _found(service.answer_question, message_id, body.option)


@router.post("/questions/{message_id}/remember")
def remember_question(message_id: int):
    return _found(service.remember_question, message_id)


@router.post("/questions/{message_id}/something-else")
def something_else(message_id: int):
    return _found(service.something_else, message_id)


@router.post("/proposals/{proposal_id}/show-all", status_code=202)
def show_all(proposal_id: int):
    _found(service.show_all, proposal_id)
    return {"shown": proposal_id}


@router.post("/proposals/{proposal_id}/apply")
def apply_proposal(proposal_id: int, body: ApplyIn):
    return _found(service.apply_proposal, proposal_id, body.version)


@router.post("/proposals/{proposal_id}/remember")
def remember_shops(proposal_id: int):
    return _found(service.remember_shops, proposal_id)


@router.post("/proposals/{proposal_id}/reject")
def reject_proposal(proposal_id: int):
    return _found(service.reject_proposal, proposal_id)
