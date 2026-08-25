"""Firestore access.

Duplicated deliberately across services rather than shared: each is an
independently deployable Cloud Run unit, and fifteen lines of boilerplate is a
better trade than a shared package every image has to carry.
"""

import os

from google.cloud import firestore

PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", "alltheway-local")

db = firestore.Client(project=PROJECT)


def user_doc(uid: str):
    return db.collection("users").document(uid)


def watchers(uid: str):
    return user_doc(uid).collection("watchers")


def runs(uid: str):
    return user_doc(uid).collection("runs")


def sessions(uid: str):
    return user_doc(uid).collection("sessions")


def preferences(uid: str):
    return user_doc(uid).collection("preferences")
