"""Small wording helpers for the chats: month names. (Spotting query text in the live log is botkit's.)"""

_MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
           "November", "December")


def month_name(label: str) -> str:
    year, month = label.split("-")
    return f"{_MONTHS[int(month) - 1]} {year}"
