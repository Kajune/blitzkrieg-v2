import time
import msgspec
from pydantic import BaseModel
from dataclasses import dataclass

# 1. モデルの定義
class PydanticModel(BaseModel):
    id: int
    name: str
    active: bool

@dataclass
class DataclassModel:
    id: int
    name: str
    active: bool

class MsgspecModel(msgspec.Struct):
    id: int
    name: str
    active: bool

# テストデータ (10万件)
data = [{"id": i, "name": f"item_{i}", "active": True} for i in range(10_000)]

def benchmark():
    # Pydanticの計測
    start = time.perf_counter()
    for item in data:
        PydanticModel(**item)
    print(f"Pydantic: {time.perf_counter() - start:.4f}秒")

    # Dataclassesの計測
    start = time.perf_counter()
    for item in data:
        DataclassModel(**item)
    print(f"Dataclasses: {time.perf_counter() - start:.4f}秒")

    # Msgspecの計測
    start = time.perf_counter()
    for item in data:
        msgspec.convert(item, MsgspecModel)
    print(f"Msgspec: {time.perf_counter() - start:.4f}秒")

if __name__ == "__main__":
    benchmark()