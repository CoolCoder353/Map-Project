import { describe, expect, it } from 'vitest';
import { QLD_SPEED_SIGNS_DATASET, parseCsv, rowToSign, signsFromCsv, surveyCsvUrls } from '../../src/pipeline/speed-signs.js';

const HEADER = 'NUMBER,LATITUDE,LONGITUDE,SPEED,SIGN_TXT,SIGN_NOTE,SIGN_NUM,SIDE,ST_NAME,ST_TYPE,LOCALITY,DIRECTION,DATE,TIME';
const row = (over: Record<string, string> = {}) => ({
  NUMBER: '190805-G1-412',
  LATITUDE: '-27.59135441',
  LONGITUDE: '153.1558101',
  SPEED: '60',
  SIGN_TXT: '',
  SIGN_NOTE: '',
  SIGN_NUM: 'R4-1A',
  SIDE: 'LEFT',
  ST_NAME: 'FORD',
  ST_TYPE: 'ROAD',
  LOCALITY: 'BURBANK',
  DIRECTION: 'NORTHWEST',
  DATE: '5/08/2019',
  TIME: '121425',
  ...over,
});

describe('reading the speed signs survey', () => {
  it('splits CSV with quoted fields, doubled quotes and either line ending', () => {
    expect(parseCsv('a,b\r\n"c, d","e ""f"""\n\n')).toEqual([['a', 'b'], ['c, d', 'e "f"']]);
  });

  it('takes a speed limit sign with which way it faces and when it was surveyed', () => {
    expect(rowToSign(row())).toEqual({ id: '190805-G1-412', lon: 153.1558101, lat: -27.59135441, kmh: 60, bearing: 315, unsigned: false, surveyedOn: '2019-08-05' });
    expect(rowToSign(row({ SIGN_NUM: 'UNSIGNED', SPEED: '50', DIRECTION: 'east' }))).toMatchObject({ kmh: 50, bearing: 90, unsigned: true });
    expect(rowToSign(row({ SIGN_NUM: 'R4-10A', SPEED: '40' }))).toMatchObject({ kmh: 40 });
    expect(rowToSign(row({ SIGN_TXT: 'SPEED LIMIT' }))).not.toBeNull();
  });

  it('leaves out signs that hold only some of the time, end a zone, or can’t be read', () => {
    expect(rowToSign(row({ SIGN_NUM: 'R4-Q01A', SIGN_TXT: 'SCHOOL ZONE 7-9 2-4 SCHOOL DAYS', SPEED: '40' }))).toBeNull();
    expect(rowToSign(row({ SIGN_NUM: 'R4-1A', SIGN_TXT: 'SCHOOL ZONE' }))).toBeNull();
    expect(rowToSign(row({ SIGN_TXT: 'RAMP SPEED' }))).toBeNull();
    expect(rowToSign(row({ SIGN_NUM: 'R4-11A', SPEED: '40' }))).toBeNull();
    expect(rowToSign(row({ SIGN_NUM: 'TC1785', SPEED: 'VARIABLE' }))).toBeNull();
    expect(rowToSign(row({ SPEED: 'UNKNOWN' }))).toBeNull();
    expect(rowToSign(row({ SPEED: '0' }))).toBeNull();
    expect(rowToSign(row({ DIRECTION: '' }))).toBeNull();
    expect(rowToSign(row({ NUMBER: '' }))).toBeNull();
    // Nowhere near Queensland: a typo.
    expect(rowToSign(row({ LATITUDE: '27.59' }))).toBeNull();
    expect(rowToSign(row({ DATE: 'unknown' }))).toMatchObject({ surveyedOn: null });
  });

  it('reads a region’s file, with a byte order mark', () => {
    const values = (o: Record<string, string>) => Object.values(row(o)).join(',');
    const text = `\uFEFF${HEADER}\n${values({})}\n${values({ NUMBER: 'x2', SIGN_NUM: 'TC1010' })}\n`;
    expect(signsFromCsv(text).map((s) => s.id)).toEqual(['190805-G1-412']);
    expect(signsFromCsv('')).toEqual([]);
  });
});

describe('finding the survey’s files', () => {
  const answer = (body: unknown, ok = true) => async () => ({ ok, status: ok ? 200 : 503, text: async () => '', json: async () => body });

  it('lists the CSV for each region from the dataset’s description', async () => {
    const asked: string[] = [];
    const fetchImpl = async (url: string) => {
      asked.push(url);
      return answer({
        result: {
          resources: [
            { name: 'Winton', url: 'https://www.data.qld.gov.au/x/winton.csv', format: 'CSV' },
            { name: 'Notes', url: 'https://www.data.qld.gov.au/x/notes.pdf', format: 'PDF' },
            { name: 'Odd', url: 'http://insecure.example/odd.csv', format: 'csv' },
          ],
        },
      })();
    };
    expect(await surveyCsvUrls(fetchImpl)).toEqual([{ name: 'Winton', url: 'https://www.data.qld.gov.au/x/winton.csv' }]);
    expect(asked).toEqual([QLD_SPEED_SIGNS_DATASET]);
  });

  it('says so when the dataset is down or lists nothing', async () => {
    await expect(surveyCsvUrls(answer({}, false))).rejects.toThrow('answered 503');
    await expect(surveyCsvUrls(answer({ result: { resources: [] } }))).rejects.toThrow('lists no CSV files');
  });
});
