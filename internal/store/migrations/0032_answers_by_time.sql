-- A question's answers by when they were given: how the day's players answered it today is counted with every
-- answer (play.dayCrowd), from that day's answers only, not from all the question ever had.
DROP INDEX answers_question;
CREATE INDEX answers_question ON answers (question_id, at);
