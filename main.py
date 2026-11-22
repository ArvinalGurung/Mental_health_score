
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Literal
import joblib
import pandas as pd

model = joblib.load("Mental_health.pkl")

top_countries = [
    'Other', 'India', 'USA', 'Canada', 'Australia',
    'UK', 'Germany', 'Mexico', 'Turkey', 'France'
]

# Countries the saved model's OneHotEncoder actually learned during training.
# (Read from the pickle so the API never sends a category the model can't handle.)
_nominal_encoder = (
    model.named_steps["preprocessor"]
    .named_transformers_["nominal"]
    .named_steps["encode"]
)
known_countries = set(_nominal_encoder.categories_[1])  # nominal_col[1] == 'Country'

app = FastAPI()

# FIX 1: allow the browser frontend to call this API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # fine for local development; restrict when deploying
    allow_methods=["*"],
    allow_headers=["*"],
)


class StudentData(BaseModel):
    age: int = Field(..., ge=10, le=100)
    gender: Literal['Male', 'Female']
    country: str
    academic_level: Literal['Undergraduate', 'Graduate', 'High School']
    most_used_platform: Literal[
        'Facebook', 'LinkedIn', 'Instagram', 'Snapchat',
        'Twitter', 'YouTube', 'TikTok', 'LINE',
        'KakaoTalk', 'VKontakte', 'WhatsApp', 'WeChat'
    ]
    purpose_of_use: Literal[
        'Networking', 'Education', 'Entertainment', 'News'
    ]
    avg_daily_usage_hours: float = Field(..., ge=0, le=24)
    daily_unlocks: int = Field(..., ge=0)
    study_hours: float = Field(..., ge=0, le=24)
    physical_activity_hours: float = Field(..., ge=0, le=24)
    sleep_hours_per_night: float = Field(..., ge=0, le=24)
    stress_level: Literal['Medium', 'Low', 'Very High', 'High']


class PredictionResponse(BaseModel):
    mental_score: float


@app.get("/")
def hello():
    return {"message": "Hello"}


@app.post("/predict", response_model=PredictionResponse)
def pred(data: StudentData):

    country = (
        data.country if data.country in top_countries
        else "Other"
    )
    # FIX 2: the saved model only knows these countries; anything else -> "Other"
    if country not in known_countries:
        country = "Other"

    input_row = pd.DataFrame([{
        'Age': data.age,
        'Gender': data.gender,
        'Academic_Level': data.academic_level,
        'Most_Used_Platform': data.most_used_platform,
        'Purpose_Of_Use': data.purpose_of_use,
        'Avg_Daily_Usage_Hours': data.avg_daily_usage_hours,
        'Daily_Unlocks': data.daily_unlocks,
        'Study_Hours': data.study_hours,
        'Physical_Activity_Hours': data.physical_activity_hours,
        'Sleep_Hours_Per_Night': data.sleep_hours_per_night,
        'Stress_Level': data.stress_level,
        'Country': country  # FIX 3: model was trained on a column named 'Country'
    }])

    prediction = model.predict(input_row)[0]

    return PredictionResponse(
        mental_score=round(float(prediction), 2)
    )
