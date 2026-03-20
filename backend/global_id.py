import numpy as np
from datetime import datetime

class GlobalIDManager:
    def __init__(self, threshold=0.7, memory_limit=500):
        self.threshold = threshold
        self.memory_limit = memory_limit
        self.global_db = {} # {global_id: {"embedding": vector, "last_seen_frame": frame_id}}
        self.next_global_id = 1
        self.track_to_global = {} # Map temporary track_id to global_id

    def cosine_similarity(self, a, b):
        if a is None or b is None:
            return 0.0
        return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-6)

    def match_new_track(self, track_id, embedding, frame_id):
        """
        When a new track_id appears, find if it matches an existing global_id.
        """
        best_similarity = -1
        best_global_id = None
        
        for g_id, data in self.global_db.items():
            sim = self.cosine_similarity(embedding, data["embedding"])
            if sim > best_similarity:
                best_similarity = sim
                best_global_id = g_id
        
        if best_similarity > self.threshold:
            print(f"Match found! Track ID {track_id} matches Global ID {best_global_id} (Similarity: {best_similarity:.2f})")
            self.track_to_global[track_id] = best_global_id
            self.update_embedding(best_global_id, embedding, frame_id)
            return best_global_id
        else:
            new_id = self.next_global_id
            self.next_global_id += 1
            print(f"Assigning NEW Global ID {new_id} to Track ID {track_id}")
            self.global_db[new_id] = {
                "embedding": embedding,
                "last_seen_frame": frame_id
            }
            self.track_to_global[track_id] = new_id
            return new_id

    def update_embedding(self, global_id, current_embedding, frame_id):
        if global_id in self.global_db:
            old_embedding = self.global_db[global_id]["embedding"]
            # 0.8 * old + 0.2 * new
            self.global_db[global_id]["embedding"] = 0.8 * old_embedding + 0.2 * current_embedding
            self.global_db[global_id]["last_seen_frame"] = frame_id

    def cleanup(self, current_frame_id):
        to_delete = []
        for g_id, data in self.global_db.items():
            if current_frame_id - data["last_seen_frame"] > self.memory_limit:
                to_delete.append(g_id)
        
        for g_id in to_delete:
            print(f"Cleaning up Global ID {g_id} (Not seen for {self.memory_limit} frames)")
            del self.global_db[g_id]
            # Clean up track_to_global mapping for this global_id
            keys_to_del = [k for k, v in self.track_to_global.items() if v == g_id]
            for k in keys_to_del:
                del self.track_to_global[k]

if __name__ == "__main__":
    manager = GlobalIDManager()
    print("GlobalIDManager initialized.")
